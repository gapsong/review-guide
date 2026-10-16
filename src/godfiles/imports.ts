import * as path from "path";
import { Language } from "./sourceFiles";

// The module-level import scan: which modules a file imports, resolved to files of the repo. Only
// module granularity, because areas are coarse: "knows N areas" counts the other areas a file
// imports from, and the language-server breadth (breadth.ts) uses the statement lines to tell an
// import or re-export from a real use. Names are the language server's business, not this scan's.
//
//   checkout.ts ──import { charge } from "@/shop/payment"──►  src/shop/payment.ts   (by path suffix)
//   views.py    ──from ..shop import payment─────────────►   shop/payment.py       (relative)

export interface ImportStatement {
  // A TypeScript specifier ("./x", "@/lib/x") or a Python module, dotted or relative (".x", "..");
  // undefined for a statement that only passes names on ("export { a };", "__all__ = [...]").
  module: string | undefined;
  // Python "from m import a": a may be the submodule m.a; it is tried before m.
  submodules: string[];
  // The 0-based lines of an import or export ... from statement. undefined for require() and
  // import(), which sit inside other code.
  lines?: { first: number; last: number };
}

export function importsOf(text: string, language: Language): ImportStatement[] {
  if (language === "typescript") {
    return typescriptImports(blankComments(text, "typescript"));
  }
  return language === "python" ? pythonImports(blankComments(text, "python")) : [];
}

// The 0-based lines that belong to import and re-export statements: a reference there names the
// thing, it does not use it.
export function importLinesOf(text: string, language: Language): Set<number> {
  const lines = new Set<number>();
  for (const statement of importsOf(text, language)) {
    for (let line = statement.lines?.first ?? 0; statement.lines && line <= statement.lines.last; line++) {
      lines.add(line);
    }
  }
  return lines;
}

export interface ScannedSource {
  path: string;
  language: Language;
  text: string;
}

// The repo files each source imports from, sorted; unresolved imports (packages, the standard
// library) are left out.
export function importedFiles(sources: ScannedSource[]): Map<string, string[]> {
  const typescript = new TypescriptModuleIndex(sources.filter((source) => source.language === "typescript").map((source) => source.path));
  const python = new PythonModuleIndex(sources.filter((source) => source.language === "python").map((source) => source.path));
  return new Map(sources.map((source) => {
    const files = new Set<string>();
    for (const statement of importsOf(source.text, source.language)) {
      if (statement.module === undefined) {
        continue;
      }
      const module = statement.module;
      const target = source.language === "typescript"
        ? typescript.resolve(source.path, module)
        : [...statement.submodules, module].map((candidate) => python.resolve(source.path, candidate)).find((file) => file !== undefined);
      if (target !== undefined && target !== source.path) {
        files.add(target);
      }
    }
    return [source.path, [...files].sort()];
  }));
}

// TypeScript and JavaScript ------------------------------------------------------------------------

// The statement forms, so that "export const label = 'copy from'" or a function body before a
// re-export is never taken for an import:
//   import x from "m"   import x, { a,\n b } from "m"   import * as n from "m"   import type { T } from "m"
//   import "m"          export { a } from "m"           export * from "m"         export * as n from "m"
//   export { a, b };    (a barrel's re-export of what it imported: lines only, no module)
const typescriptStatements = [
  /(?<![\w$.])import\s+(?:type\s+)?(?:[\w$]+\s*(?:,\s*)?)?(?:\{[^{}'"`;]*\}|\*\s*as\s+[\w$]+)?\s*from\s*(['"])([^'"\n]+)\1/g,
  /(?<![\w$.])import\s*(['"])([^'"\n]+)\1/g,
  /(?<![\w$.])export\s+(?:type\s+)?(?:\*(?:\s*as\s+[\w$]+)?|\{[^{}'"`;]*\})\s*from\s*(['"])([^'"\n]+)\1/g,
  /(?<![\w$.])export\s*\{[^{}'"`;]*\}(?!\s*from)/g,
];

function typescriptImports(code: string): ImportStatement[] {
  const statements: ImportStatement[] = [];
  for (const pattern of typescriptStatements) {
    for (const match of code.matchAll(pattern)) {
      statements.push({ module: match[2], submodules: [], lines: { first: lineAt(code, match.index!), last: lineAt(code, match.index! + match[0].length) } });
    }
  }
  for (const match of code.matchAll(/(?<![\w$.])(?:require|import)\(\s*['"]([^'"\n]+)['"]\s*\)/g)) {
    statements.push({ module: match[1], submodules: [] });
  }
  return statements;
}

const resolvableExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];

class TypescriptModuleIndex {
  private readonly files: Set<string>;
  private readonly bySuffix = new SuffixIndex();

  constructor(paths: string[]) {
    this.files = new Set(paths);
    for (const file of paths) {
      const withoutExtension = file.replace(/\.[^./]+$/, "");
      this.bySuffix.add(withoutExtension.split("/"), file);
      if (/(^|\/)index$/.test(withoutExtension)) {
        this.bySuffix.add(withoutExtension.split("/").slice(0, -1), file);
      }
    }
  }

  resolve(importer: string, specifier: string): string | undefined {
    return specifier.startsWith(".") ? this.resolveRelative(importer, specifier) : this.resolveBySuffix(importer, specifier);
  }

  // "./x" is x.ts, x.tsx, …, x/index.ts; "./x.js" is also x.ts, as TypeScript's ESM imports write it.
  private resolveRelative(importer: string, specifier: string): string | undefined {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
    const withoutJsExtension = base.replace(/\.(m|c)?jsx?$/, "");
    const candidates = [
      base,
      ...resolvableExtensions.map((extension) => base + extension),
      ...resolvableExtensions.map((extension) => withoutJsExtension + extension),
      ...resolvableExtensions.map((extension) => `${base}/index${extension}`),
    ];
    return candidates.find((candidate) => this.files.has(candidate));
  }

  // A path alias like "@/lib/x", "~/lib/x" or "#lib/x" points into the repo: its path after the
  // alias is matched against the end of the repo's paths. A bare name ("react", "fs") is a package,
  // not a file of the repo, so a one-part suffix counts only after such an alias.
  private resolveBySuffix(importer: string, specifier: string): string | undefined {
    const parts = specifier.replace(/\.(m|c)?[jt]sx?$/, "").split("/");
    const startsWithAlias = parts[0] === "@" || parts[0] === "~" || parts[0].startsWith("#");
    const suffixes = startsWithAlias ? [parts.slice(1)] : [parts, ...(parts[0].startsWith("@") ? [parts.slice(1)] : [])];
    for (const suffix of suffixes) {
      if (suffix.length === 0 || (suffix.length === 1 && !startsWithAlias)) {
        continue;
      }
      const found = this.bySuffix.closestTo(importer, suffix);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
}

// Python -------------------------------------------------------------------------------------------

const pythonIdentifier = "[A-Za-z_]\\w*";

// "import a.b as c, d" and "from m import (x,\n y)" at any indentation: a function's import is a
// dependency too.
function pythonImports(code: string): ImportStatement[] {
  const statements: ImportStatement[] = [];
  const fromImports = new RegExp(`^[ \\t]*from(?:[ \\t]|\\\\\\n)+(\\.*(?:${pythonIdentifier}(?:\\.${pythonIdentifier})*)?)(?:[ \\t]|\\\\\\n)+import(?:[ \\t]|\\\\\\n)+(\\([^)]*\\)|(?:[^\\n;\\\\]|\\\\\\n)+)`, "gm");
  for (const match of code.matchAll(fromImports)) {
    const module = match[1];
    const names = match[2].replace(/[()\\]/g, " ").split(",").map((part) => part.trim().split(/\s+as\s+/)[0]).filter((name) => /^\w+$/.test(name));
    const submodules = names.map((name) => `${module}${module.endsWith(".") ? "" : "."}${name}`);
    statements.push({ module, submodules, lines: linesOf(code, match.index!, match[0].length) });
  }
  // "__all__ = [...]" names what the module passes on; a language server finds references there.
  for (const match of code.matchAll(/^__all__[ \t]*(?::[^=\n]*)?\+?=[ \t]*[[(][^\])]*[\])]/gm)) {
    statements.push({ module: undefined, submodules: [], lines: linesOf(code, match.index!, match[0].length) });
  }
  // Not the "import" of a "from" statement continued on this line.
  const plainImports = /^(?<!\\\n)[ \t]*import[ \t]+((?:[^\n;\\]|\\\n)+)/gm;
  for (const match of code.matchAll(plainImports)) {
    const lines = linesOf(code, match.index!, match[0].length);
    for (const part of match[1].replace(/\\\n/g, " ").split(",")) {
      const module = part.trim().split(/\s+as\s+/)[0];
      if (/^[\w.]+$/.test(module)) {
        statements.push({ module, submodules: [], lines });
      }
    }
  }
  return statements;
}

class PythonModuleIndex {
  private readonly byDottedPath = new Map<string, string>();
  private readonly bySuffix = new SuffixIndex();

  constructor(paths: string[]) {
    for (const file of paths) {
      const parts = modulePartsOf(file);
      this.byDottedPath.set(parts.join("."), file);
      this.bySuffix.add(parts, file);
    }
  }

  // Relative imports are resolved from the importer's package; absolute ones by dotted-path
  // suffix, so "app.models" finds src/app/models.py in a src layout.
  resolve(importer: string, module: string): string | undefined {
    if (module.startsWith(".")) {
      const dotted = absoluteModuleOf(importer, module);
      return dotted === undefined ? undefined : this.byDottedPath.get(dotted);
    }
    return this.bySuffix.closestTo(importer, module.split("."));
  }
}

// "src/app/models.py" is src.app.models; "src/app/__init__.py" is the package src.app.
function modulePartsOf(file: string): string[] {
  const parts = file.replace(/\.py$/, "").split("/");
  return parts[parts.length - 1] === "__init__" ? parts.slice(0, -1) : parts;
}

// "..x" from src/app/views/home.py is src.app.x: one dot is the importer's own package.
function absoluteModuleOf(importer: string, relative: string): string | undefined {
  const dots = /^\.+/.exec(relative)![0].length;
  const rest = relative.slice(dots).replace(/^\./, "");
  const isPackage = importer.endsWith("/__init__.py") || importer === "__init__.py";
  const packageParts = isPackage ? modulePartsOf(importer) : modulePartsOf(importer).slice(0, -1);
  if (dots - 1 > packageParts.length) {
    return undefined;
  }
  const base = packageParts.slice(0, packageParts.length - (dots - 1));
  return [...base, ...(rest === "" ? [] : rest.split("."))].join(".");
}

// Both languages ----------------------------------------------------------------------------------

// Files by every tail of their path parts: "shop/payment" finds src/shop/payment.ts.
class SuffixIndex {
  private readonly files = new Map<string, string[]>();

  add(parts: string[], file: string): void {
    for (let start = 0; start < parts.length; start++) {
      const key = parts.slice(start).join("/");
      const files = this.files.get(key) ?? [];
      if (!files.includes(file)) {
        files.push(file);
      }
      this.files.set(key, files);
    }
  }

  // With several files of the same suffix, the one that shares the most folders with the importer
  // wins (a monorepo's own package); when that is still a tie the import is not resolved, because
  // picking one would name an area that may be the other's.
  closestTo(importer: string, suffix: string[]): string | undefined {
    const files = this.files.get(suffix.join("/")) ?? [];
    if (files.length <= 1) {
      return files[0];
    }
    const scored = files.map((file) => ({ file, shared: sharedFolderCount(importer, file) })).sort((first, second) => second.shared - first.shared);
    return scored[0].shared > scored[1].shared ? scored[0].file : undefined;
  }
}

function sharedFolderCount(first: string, second: string): number {
  const firstFolders = first.split("/").slice(0, -1);
  const secondFolders = second.split("/").slice(0, -1);
  let shared = 0;
  while (shared < firstFolders.length && firstFolders[shared] === secondFolders[shared]) {
    shared++;
  }
  return shared;
}

// Comments (and in Python strings, so a docstring's "import x" is not an import) become blanks of
// the same length; newlines stay, so offsets and lines stay where they were. TypeScript strings are
// kept: the specifier is one, and "src/**/*.ts" holds a "/*" that opens no comment.
function blankComments(source: string, language: "typescript" | "python"): string {
  // A byte order mark and the \r of CRLF become blanks too: "\\\r\n" continues a line like "\\\n".
  const text = source.replace(/\\\r\n/g, " \\\n").replace(/\r(?=\n)/g, " ");
  let code = text.startsWith("\uFEFF") ? " " : "";
  let i = code.length;
  while (i < text.length) {
    const character = text[i];
    const commentEnd = language === "typescript" ? typescriptCommentEnd(text, i) : character === "#" ? lineEnd(text, i) : undefined;
    if (commentEnd !== undefined) {
      code += blanked(text.slice(i, commentEnd));
      i = commentEnd;
    } else if (character === "'" || character === '"' || (character === "`" && language === "typescript")) {
      const end = endOfString(text, i, language === "python");
      code += language === "python" ? blanked(text.slice(i, end)) : text.slice(i, end);
      i = end;
    } else {
      code += character;
      i++;
    }
  }
  return code;
}

function typescriptCommentEnd(text: string, i: number): number | undefined {
  if (text[i] !== "/") {
    return undefined;
  }
  if (text[i + 1] === "/") {
    return lineEnd(text, i);
  }
  if (text[i + 1] === "*") {
    const end = text.indexOf("*/", i + 2);
    return end === -1 ? text.length : end + 2;
  }
  return undefined;
}

function lineEnd(text: string, i: number): number {
  const end = text.indexOf("\n", i);
  return end === -1 ? text.length : end;
}

// The index after the closing quote; a string that is never closed ends at its line (or the text).
// Python's triple quotes span lines; so does a TypeScript template string.
function endOfString(text: string, start: number, python: boolean): number {
  const quote = text[start];
  const closing = python && text.startsWith(quote.repeat(3), start) ? quote.repeat(3) : quote;
  const spansLines = closing.length === 3 || quote === "`";
  let i = start + closing.length;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
    } else if (text.startsWith(closing, i)) {
      return i + closing.length;
    } else if (text[i] === "\n" && !spansLines) {
      return i;
    } else {
      i++;
    }
  }
  return text.length;
}

function blanked(text: string): string {
  return text.replace(/[^\n]/g, " ");
}

function lineAt(code: string, offset: number): number {
  let line = 0;
  for (let i = code.indexOf("\n"); i !== -1 && i < offset; i = code.indexOf("\n", i + 1)) {
    line++;
  }
  return line;
}

function linesOf(code: string, start: number, length: number): { first: number; last: number } {
  const text = code.slice(start, start + length).replace(/\s+$/, "");
  const leading = /^\s*/.exec(text)![0].length;
  return { first: lineAt(code, start + leading), last: lineAt(code, start + text.length) };
}
