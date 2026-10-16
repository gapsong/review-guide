// Names and imports of TypeScript and JavaScript files, read with regular expressions. The extension
// has no TypeScript compiler at run time, and these few forms cover how modules use each other.

// What one file takes from another module: the names it imports, or all of them (export *).
export interface ModuleUse {
  specifier: string;
  names: string[];
  usesAllNames: boolean;
  // A re-export passes names on: "export { a as b } from" offers a as b, "export * from" offers all.
  reexported?: Reexport[];
  reexportsAll?: boolean;
}

export interface Reexport {
  importedName: string;
  exportedAs: string;
}

const identifier = "[A-Za-z_$][\\w$]*";

// The top-level names other files can import. "default" stands for a default export.
export function exportedNamesOf(text: string): string[] {
  const code = withoutComments(text);
  const names = new Set<string>();
  const declaration = new RegExp(`^[ \\t]*export\\s+(?:declare\\s+)?(default\\s+)?(?:abstract\\s+)?(?:async\\s+)?(?:function\\s*\\*?|class|interface|type|enum|const\\s+enum|namespace|module)\\s+(${identifier})`, "gm");
  for (const match of code.matchAll(declaration)) {
    names.add(match[1] ? "default" : match[2]);
  }
  const variables = new RegExp(`^[ \\t]*export\\s+(?:declare\\s+)?(?:const|let|var)\\s+([^=;]+)`, "gm");
  for (const match of code.matchAll(variables)) {
    for (const name of declaredNames(match[1])) {
      names.add(name);
    }
  }
  if (/^[ \t]*export\s+default\b/m.test(code) || /^[ \t]*export\s*=/m.test(code)) {
    names.add("default");
  }
  const lists = /^[ \t]*export\s+(?:type\s+)?\{([^}]*)\}/gm;
  for (const match of code.matchAll(lists)) {
    for (const entry of listEntries(match[1])) {
      names.add(entry.exportedAs);
    }
  }
  const starAs = new RegExp(`^[ \\t]*export\\s+\\*\\s+as\\s+(${identifier})`, "gm");
  for (const match of code.matchAll(starAs)) {
    names.add(match[1]);
  }
  for (const name of commonJsExports(code)) {
    names.add(name);
  }
  return [...names];
}

// Every module this file imports names from, by import, re-export, require or dynamic import.
export function moduleUsesOf(text: string): ModuleUse[] {
  const code = withoutComments(text);
  return [...staticImports(code), ...reexports(code), ...requires(code), ...dynamicImports(code)];
}

function staticImports(code: string): ModuleUse[] {
  const uses: ModuleUse[] = [];
  const pattern = /(?:^|[;\s])import\s+(?:type\s+)?([^'"`;]*?)\s+from\s+['"]([^'"]+)['"]/gm;
  for (const match of code.matchAll(pattern)) {
    uses.push({ specifier: match[2], names: importClauseNames(match[1], code), usesAllNames: false });
  }
  const importEquals = new RegExp(`(?:^|[;\\s])import\\s+(${identifier})\\s*=\\s*require\\(\\s*['"]([^'"]+)['"]\\s*\\)`, "gm");
  for (const match of code.matchAll(importEquals)) {
    uses.push({ specifier: match[2], names: membersUsed(match[1], code), usesAllNames: false });
  }
  return uses;
}

function importClauseNames(clause: string, code: string): string[] {
  const names: string[] = [];
  const braces = /\{([^}]*)\}/.exec(clause);
  if (braces) {
    names.push(...listEntries(braces[1]).map((entry) => entry.importedName));
  }
  const namespace = new RegExp(`\\*\\s+as\\s+(${identifier})`).exec(clause);
  if (namespace) {
    names.push(...membersUsed(namespace[1], code));
  }
  const beforeBraces = clause.replace(/\{[^}]*\}/, "").replace(/\*\s+as\s+[\w$]+/, "").replace(/,/g, " ").trim();
  if (new RegExp(`^${identifier}$`).test(beforeBraces)) {
    names.push("default");
  }
  return names;
}

function reexports(code: string): ModuleUse[] {
  const uses: ModuleUse[] = [];
  const lists = /^[ \t]*export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gm;
  for (const match of code.matchAll(lists)) {
    const entries = listEntries(match[1]);
    uses.push({ specifier: match[2], names: entries.map((entry) => entry.importedName), usesAllNames: false, reexported: entries });
  }
  const stars = /^[ \t]*export\s+(?:type\s+)?\*\s*(as\s+[\w$]+\s*)?from\s*['"]([^'"]+)['"]/gm;
  for (const match of code.matchAll(stars)) {
    uses.push({ specifier: match[2], names: [], usesAllNames: true, reexportsAll: match[1] === undefined });
  }
  return uses;
}

function requires(code: string): ModuleUse[] {
  const uses: ModuleUse[] = [];
  const pattern = new RegExp(`(?:(const|let|var)\\s+(\\{[^}]*\\}|${identifier})\\s*=\\s*)?require\\(\\s*['"]([^'"]+)['"]\\s*\\)(\\.(${identifier}))?`, "g");
  for (const match of code.matchAll(pattern)) {
    const [, , binding, specifier, , member] = match;
    uses.push({ specifier, names: boundNames(binding, member, code), usesAllNames: false });
  }
  return uses;
}

function dynamicImports(code: string): ModuleUse[] {
  const uses: ModuleUse[] = [];
  const pattern = new RegExp(`(?:(const|let|var)\\s+(\\{[^}]*\\}|${identifier})\\s*=\\s*(?:await\\s+)?)?\\bimport\\(\\s*['"]([^'"]+)['"]\\s*\\)`, "g");
  for (const match of code.matchAll(pattern)) {
    const [, , binding, specifier] = match;
    uses.push({ specifier, names: boundNames(binding, undefined, code), usesAllNames: false });
  }
  return uses;
}

// const { a, b: c } = require("x")  takes a and b;  const m = require("x")  takes the m.<name> used;
// require("x").a  takes a. A require whose result is not bound takes no name.
function boundNames(binding: string | undefined, member: string | undefined, code: string): string[] {
  if (member) {
    return [member];
  }
  if (!binding) {
    return [];
  }
  if (binding.startsWith("{")) {
    return binding.slice(1, -1).split(",").map((part) => part.split(":")[0].trim()).filter((name) => new RegExp(`^${identifier}$`).test(name));
  }
  return membersUsed(binding, code);
}

// import * as n: the names of the module this file uses, as n.<name>.
export function membersUsed(namespace: string, code: string): string[] {
  const escaped = namespace.replace(/\$/g, "\\$");
  const pattern = new RegExp(`(?<![\\w$.])${escaped}\\.(${identifier})`, "g");
  return [...new Set([...code.matchAll(pattern)].map((match) => match[1]))];
}

interface ListEntry {
  importedName: string;
  exportedAs: string;
}

// "a, b as c, type d" from an import or export list.
function listEntries(list: string): ListEntry[] {
  return list.split(",").map((part) => part.trim().replace(/^type\s+/, "")).filter((part) => part !== "").map((part) => {
    const [name, alias] = part.split(/\s+as\s+/).map((piece) => piece.trim());
    return { importedName: name, exportedAs: alias ?? name };
  });
}

// "a = 1, b = 2" or "{ a, b: c } = x" after export const.
function declaredNames(declarations: string): string[] {
  const trimmed = declarations.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return trimmed.slice(1).split(/[,}\]]/).map((part) => part.split(":").pop()!.trim()).filter((name) => new RegExp(`^${identifier}$`).test(name));
  }
  const first = new RegExp(`^(${identifier})`).exec(trimmed);
  return first ? [first[1]] : [];
}

function commonJsExports(code: string): string[] {
  const names: string[] = [];
  for (const match of code.matchAll(new RegExp(`(?:^|[^\\w$.])(?:module\\.)?exports\\.(${identifier})\\s*=`, "gm"))) {
    names.push(match[1]);
  }
  const objectExport = /module\.exports\s*=\s*\{([^}]*)\}/.exec(code);
  if (objectExport) {
    for (const part of objectExport[1].split(",")) {
      const key = new RegExp(`^\\s*(?:async\\s+)?(${identifier})`).exec(part);
      if (key) {
        names.push(key[1]);
      }
    }
  } else if (/module\.exports\s*=/.test(code)) {
    names.push("default");
  }
  return names;
}

// Comments become spaces, so a commented-out import is not an import. Strings are kept as they are:
// "src/**/*.ts" holds a "/*" that opens no comment.
export function withoutComments(text: string): string {
  let code = "";
  let i = 0;
  while (i < text.length) {
    const character = text[i];
    if (character === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end;
    } else if (character === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
      code += " ";
    } else if (character === "'" || character === '"' || character === "`") {
      const end = endOfString(text, i);
      code += text.slice(i, end);
      i = end;
    } else {
      code += character;
      i++;
    }
  }
  return code;
}

// The index after the closing quote; a string that is never closed ends at its line (or the text).
function endOfString(text: string, start: number): number {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
    } else if (text[i] === quote) {
      return i + 1;
    } else if (text[i] === "\n" && quote !== "`") {
      return i;
    } else {
      i++;
    }
  }
  return text.length;
}
