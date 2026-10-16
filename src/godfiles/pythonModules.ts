// Names and imports of Python files, read with regular expressions: module-level definitions, and
// the import statements with their dotted (or relative) module paths.

export interface PythonImport {
  // Absolute dotted path ("a.b") or relative with its leading dots (".b", "..").
  module: string;
  // For "from m import x": x may be a name of m or a submodule m.x; resolving decides.
  importedNames: string[];
  usesAllNames: boolean;
  // For "import a.b as n" and "import a.b": the attributes used on it (n.<name>, a.b.<name>).
  attributesUsed: string[];
  // A module-level "from m import a as b" offers a as b to whoever imports this module, which is
  // how a package's __init__.py passes names on; "from m import *" passes all of them.
  reexported?: { importedName: string; exportedAs: string }[];
  reexportsAll?: boolean;
}

const identifier = "[A-Za-z_]\\w*";

// The module's public names: __all__ when it has one, else the module-level def, class and
// assignments whose name does not start with "_". A package's __init__.py also offers what it
// imports at module level ("from .app import App"): that is the package's interface.
export function publicNamesOf(text: string, isPackageInit = false): string[] {
  const code = withoutStringsAndComments(text);
  const declaredAll = allNamesOf(text, code);
  if (declaredAll !== undefined) {
    return declaredAll;
  }
  const names = new Set<string>();
  const definitions = new RegExp(`^(?:async[ \\t]+)?(?:def|class)[ \\t]+(${identifier})`, "gm");
  for (const match of code.matchAll(definitions)) {
    names.add(match[1]);
  }
  const assignments = new RegExp(`^(${identifier})[ \\t]*(?::[^=\\n]+)?=(?!=)`, "gm");
  for (const match of code.matchAll(assignments)) {
    names.add(match[1]);
  }
  if (isPackageInit) {
    for (const reexported of moduleLevelImportedNames(code)) {
      names.add(reexported);
    }
  }
  return [...names].filter((name) => !name.startsWith("_"));
}

// The public members of every module-level class, by class name: its methods (properties included)
// and class attributes whose name does not start with "_". Only the class's own indentation level
// counts, so a nested class or a local variable of a method is not a member.
export function classMembersOf(text: string): Map<string, string[]> {
  const lines = withoutStringsAndComments(text).split("\n");
  const members = new Map<string, string[]>();
  const classStart = new RegExp(`^class[ \\t]+(${identifier})`);
  for (let i = 0; i < lines.length; i++) {
    const match = classStart.exec(lines[i]);
    if (!match) {
      continue;
    }
    const names = new Set<string>();
    let bodyIndent: number | undefined;
    for (i++; i < lines.length && (lines[i].trim() === "" || /^[ \t]/.test(lines[i])); i++) {
      const indent = /^[ \t]*/.exec(lines[i])![0].length;
      if (lines[i].trim() === "") {
        continue;
      }
      bodyIndent ??= indent;
      if (indent !== bodyIndent) {
        continue;
      }
      const member = new RegExp(`^[ \\t]+(?:(?:async[ \\t]+)?def[ \\t]+(${identifier})|(${identifier})[ \\t]*(?::[^=\\n]+)?=(?!=))`).exec(lines[i]);
      const name = member?.[1] ?? member?.[2];
      if (name !== undefined && !name.startsWith("_")) {
        names.add(name);
      }
    }
    i--;
    members.set(match[1], [...names]);
  }
  return members;
}

// Every <name> this file accesses as .<name>: the members it may use of the classes it imports.
export function membersAccessed(text: string): Set<string> {
  const code = withoutStringsAndComments(text);
  return new Set([...code.matchAll(new RegExp(`\\.(${identifier})`, "g"))].map((match) => match[1]));
}

export function importsOf(text: string): PythonImport[] {
  const code = joinContinuedLines(withoutStringsAndComments(text));
  const imports: PythonImport[] = [];
  const fromImports = new RegExp(`^[ \\t]*from[ \\t]+(\\.*(?:${identifier}(?:\\.${identifier})*)?)[ \\t]+import[ \\t]+(\\([^)]*\\)|[^\\n;]+)`, "gm");
  for (const match of code.matchAll(fromImports)) {
    const list = match[2].replace(/[()]/g, " ");
    const isModuleLevel = !/^[ \t]/.test(match[0]);
    if (list.trim() === "*") {
      imports.push({ module: match[1], importedNames: [], usesAllNames: true, attributesUsed: [], reexportsAll: isModuleLevel });
      continue;
    }
    const entries = list.split(",").map((part) => part.trim()).filter((part) => part !== "").map(aliasOf);
    const reexported = isModuleLevel ? entries.map((entry) => ({ importedName: entry.name, exportedAs: entry.boundAs })) : undefined;
    imports.push({ module: match[1], importedNames: entries.map((entry) => entry.name), usesAllNames: false, attributesUsed: [], reexported });
    for (const entry of entries) {
      // "from pkg import sub" may name a submodule; its attributes are found the same way.
      imports.push({ module: `${match[1]}${match[1].endsWith(".") ? "" : "."}${entry.name}`, importedNames: [], usesAllNames: false, attributesUsed: attributesUsed(entry.boundAs, code), });
    }
  }
  const plainImports = new RegExp(`^[ \\t]*import[ \\t]+([^\\n;]+)`, "gm");
  for (const match of code.matchAll(plainImports)) {
    for (const entry of match[1].split(",").map((part) => part.trim()).filter((part) => part !== "").map(aliasOf)) {
      imports.push({ module: entry.name, importedNames: [], usesAllNames: false, attributesUsed: attributesUsed(entry.boundAs, code) });
    }
  }
  return imports;
}

function moduleLevelImportedNames(code: string): string[] {
  const names: string[] = [];
  const fromImports = /^from[ \t]+\S+[ \t]+import[ \t]+(\([^)]*\)|[^\n;]+)/gm;
  for (const match of joinContinuedLines(code).matchAll(fromImports)) {
    const list = match[1].replace(/[()]/g, " ");
    names.push(...list.split(",").map((part) => part.trim()).filter((part) => part !== "" && part !== "*").map((part) => aliasOf(part).boundAs));
  }
  return names;
}

function aliasOf(part: string): { name: string; boundAs: string } {
  const [name, alias] = part.split(/\s+as\s+/).map((piece) => piece.trim());
  return { name, boundAs: alias ?? name };
}

// The <name> in "<boundAs>.<name>", where boundAs may itself be dotted ("a.b").
function attributesUsed(boundAs: string, code: string): string[] {
  const escaped = boundAs.replace(/\./g, "\\.");
  const pattern = new RegExp(`(?<![\\w.])${escaped}\\.(${identifier})`, "g");
  return [...new Set([...code.matchAll(pattern)].map((match) => match[1]))];
}

function allNamesOf(text: string, code: string): string[] | undefined {
  const start = /^__all__[ \t]*(?::[^=\n]+)?\+?=[ \t]*[[(]/m.exec(code);
  if (!start) {
    return undefined;
  }
  // The names are strings, so they are read from the original text, from the same place on.
  const rest = text.slice(start.index + start[0].length);
  const end = rest.search(/[\])]/);
  const list = end === -1 ? rest : rest.slice(0, end);
  return [...list.matchAll(/['"]([A-Za-z_]\w*)['"]/g)].map((match) => match[1]);
}

// Strings and comments become blanks of the same length, so positions stay the same and no
// import inside a docstring counts. Newlines are kept, so line starts stay line starts.
function withoutStringsAndComments(text: string): string {
  let code = "";
  let i = 0;
  while (i < text.length) {
    const character = text[i];
    if (character === "#") {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? text.length : end;
      code += " ".repeat(stop - i);
      i = stop;
    } else if (character === "'" || character === '"') {
      const end = endOfString(text, i);
      code += blankedKeepingNewlines(text.slice(i, end));
      i = end;
    } else {
      code += character;
      i++;
    }
  }
  return code;
}

function endOfString(text: string, start: number): number {
  const quote = text[start];
  const triple = text.startsWith(quote.repeat(3), start);
  const closing = triple ? quote.repeat(3) : quote;
  let i = start + closing.length;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
    } else if (text.startsWith(closing, i)) {
      return i + closing.length;
    } else if (text[i] === "\n" && !triple) {
      return i;
    } else {
      i++;
    }
  }
  return text.length;
}

function blankedKeepingNewlines(text: string): string {
  return text.replace(/[^\n]/g, " ");
}

// "from a import (b,\n c)" is one statement; so is a line that ends in a backslash.
function joinContinuedLines(code: string): string {
  return code.replace(/\\\n/g, "  ").replace(/\(([^()]*)\)/g, (group) => group.replace(/\n/g, " "));
}
