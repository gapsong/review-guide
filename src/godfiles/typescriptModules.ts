import type { ModuleUse } from "./breadth";

// Names and imports of TypeScript and JavaScript files, read with regular expressions. The extension
// has no TypeScript compiler at run time, and these few forms cover how modules use each other.

const identifier = "[A-Za-z_$][\\w$]*";

// The top-level names other files can import. "default" stands for a default export.
export function exportedNamesOf(text: string): string[] {
  const code = withoutComments(text);
  const names = new Set<string>();
  const declaration = new RegExp(`^[ \\t]*export\\s+(?:declare\\s+)?(default\\s+)?(?:abstract\\s+)?(?:async\\s+)?(?:function\\s*\\*?|class|interface|type|enum|const\\s+enum|namespace|module|const|let|var)\\s+(${identifier})`, "gm");
  for (const match of code.matchAll(declaration)) {
    names.add(match[1] ? "default" : match[2]);
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
  return [...staticImports(code), ...reexports(code), ...requiresAndDynamicImports(code)];
}

// The public members of every top-level class, by class name (and "default" for a default export):
// methods, getters, setters, fields and constructor parameter properties that are not private,
// protected, "#" or "_"-prefixed. They are part of the interface the class offers, so a class with
// forty public methods is as broad as a module with forty functions.
export function classMembersOf(text: string): Map<string, string[]> {
  const code = withoutComments(text);
  const members = new Map<string, string[]>();
  const classes = new RegExp(`^[ \\t]*(?:export\\s+)?(default\\s+)?(?:declare\\s+)?(?:abstract\\s+)?class\\s+(${identifier})`, "gm");
  for (const match of code.matchAll(classes)) {
    const bodyStart = classBodyStart(code, match.index! + match[0].length);
    if (bodyStart === undefined) {
      continue;
    }
    const found = publicMembersOf(code.slice(bodyStart, closingBraceOf(code, bodyStart - 1)));
    members.set(match[2], found);
    if (match[1]) {
      members.set("default", found);
    }
  }
  return members;
}

const memberModifiers = /^(?:(?:public|static|readonly|async|override|declare|accessor|abstract|get|set)\s+)*\*?\s*/;

// The index after the "{" that opens the class body: the first "{" outside the type arguments of
// "extends Base<{ a: 1 }>" (a class declaration has no other braces before its body).
function classBodyStart(code: string, afterName: number): number | undefined {
  let angleDepth = 0;
  for (let i = afterName; i < code.length; i++) {
    const character = code[i];
    if (character === "<") {
      angleDepth++;
    } else if (character === ">") {
      angleDepth--;
    } else if (character === "{" && angleDepth <= 0) {
      return i + 1;
    } else if (character === ";") {
      return undefined;
    }
  }
  return undefined;
}

function publicMembersOf(body: string): string[] {
  const names = new Set<string>();
  const record = (head: string) => {
    const name = memberNameOf(head);
    if (name !== undefined) {
      names.add(name);
    }
  };
  let depth = 0;
  let headStart = 0;
  let inInitializer = false;
  let i = 0;
  while (i < body.length) {
    const character = body[i];
    if (character === "'" || character === '"' || character === "`") {
      i = endOfString(body, i);
      continue;
    }
    if (character === "{" || character === "(" || character === "[") {
      if (depth === 0 && !inInitializer) {
        const head = body.slice(headStart, i);
        if (character === "(" && head.trim() === "constructor") {
          for (const name of parameterProperties(body.slice(i + 1, closingBraceOf(body, i)))) {
            names.add(name);
          }
        } else {
          record(head);
        }
      }
      depth++;
    } else if (character === "}" || character === ")" || character === "]") {
      depth--;
      if (depth === 0) {
        headStart = i + 1;
      }
    } else if (depth === 0 && character === "=" && body[i + 1] !== ">" && !inInitializer) {
      record(body.slice(headStart, i));
      inInitializer = true;
    } else if (depth === 0 && (character === ";" || character === "\n")) {
      if (!inInitializer) {
        record(body.slice(headStart, i));
      }
      inInitializer = false;
      headStart = i + 1;
    }
    i++;
  }
  return [...names];
}

// "static create", "get title", "method<T>", "items: T" give the member's name; "private x", "#x",
// "_x", "constructor", a decorator or an index signature give none.
function memberNameOf(head: string): string | undefined {
  const trimmed = head.split(":")[0].trim();
  if (/\b(private|protected)\b/.test(trimmed)) {
    return undefined;
  }
  const match = new RegExp(`^(${identifier})\\s*[?!]?\\s*(?:<.*)?$`, "s").exec(trimmed.replace(memberModifiers, ""));
  if (!match || match[1] === "constructor" || match[1].startsWith("_")) {
    return undefined;
  }
  return match[1];
}

// constructor(public readonly id: string, private secret: number): id is a public field.
function parameterProperties(parameters: string): string[] {
  const names: string[] = [];
  for (const parameter of parameters.split(",")) {
    const match = new RegExp(`^\\s*(?:(?:public|readonly|override)\\s+)+(${identifier})`).exec(parameter);
    if (match && !/\b(private|protected)\b/.test(parameter) && !match[1].startsWith("_")) {
      names.push(match[1]);
    }
  }
  return names;
}

// The index of the bracket that closes the one at openIndex; strings are skipped.
function closingBraceOf(code: string, openIndex: number): number {
  let depth = 0;
  let i = openIndex;
  while (i < code.length) {
    const character = code[i];
    if (character === "'" || character === '"' || character === "`") {
      i = endOfString(code, i);
      continue;
    }
    if (character === "{" || character === "(" || character === "[") {
      depth++;
    } else if (character === "}" || character === ")" || character === "]") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
    i++;
  }
  return code.length;
}

// Every <name> this file accesses as .<name> (or ?.<name>): the members it may use of the classes
// it imports.
export function membersAccessed(text: string): Set<string> {
  const code = withoutComments(text);
  return new Set([...code.matchAll(new RegExp(`\\.\\s*(${identifier})`, "g"))].map((match) => match[1]));
}

function staticImports(code: string): ModuleUse[] {
  const pattern = /(?:^|[;\s])import\s+(?:type\s+)?([^'"`;]*?)\s+from\s+['"]([^'"]+)['"]/gm;
  return [...code.matchAll(pattern)].map((match) => ({ module: match[2], names: importClauseNames(match[1], code), usesAllNames: false }));
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
  const lists = /^[ \t]*export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gm;
  const stars = /^[ \t]*export\s+(?:type\s+)?\*\s*(as\s+[\w$]+\s*)?from\s*['"]([^'"]+)['"]/gm;
  return [
    ...[...code.matchAll(lists)].map((match) => ({ module: match[2], names: listEntries(match[1]).map((entry) => entry.importedName), usesAllNames: false, reexported: listEntries(match[1]) })),
    ...[...code.matchAll(stars)].map((match) => ({ module: match[2], names: [], usesAllNames: true, reexportsAll: match[1] === undefined })),
  ];
}

// require("x") and import("x"), awaited or not, with what the result is bound to.
function requiresAndDynamicImports(code: string): ModuleUse[] {
  const pattern = new RegExp(`(?:(?:const|let|var)\\s+(\\{[^}]*\\}|${identifier})\\s*=\\s*(?:await\\s+)?)?\\b(?:require|import)\\(\\s*['"]([^'"]+)['"]\\s*\\)(?:\\.(${identifier}))?`, "g");
  return [...code.matchAll(pattern)].map(([, binding, module, member]) => ({ module, names: boundNames(binding, member, code), usesAllNames: false }));
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
function membersUsed(namespace: string, code: string): string[] {
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
function withoutComments(text: string): string {
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
