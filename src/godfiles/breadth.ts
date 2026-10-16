import * as path from "path";
import { importsOf, publicNamesOf } from "./pythonModules";
import { Language } from "./sourceFiles";
import { exportedNamesOf, moduleUsesOf } from "./typescriptModules";

// Breadth: how many of a file's top-level names other source files use, and how many files use
// them. Users are found through their imports, resolved to files of the repo:
//
//   checkout.ts ──import { charge } from "@/shop/payment"──►  src/shop/payment.ts   (by path suffix)
//   views.py    ──from ..shop.payment import charge──────►   shop/payment.py       (relative)
//
// Only names the file really defines count: a name imported from it that it does not export is
// left out, so a wrong guess about an import never makes a file broader.

export interface SourceText {
  path: string;
  language: Language;
  text: string;
}

export interface Breadth {
  // Names of the file that at least one other source file uses, sorted.
  namesUsedOutside: string[];
  // The other source files that use at least one of them, sorted.
  filesUsingIt: string[];
}

// Breadth of every TypeScript/JavaScript and Python file; other languages are not in the map.
export function measureBreadth(sources: SourceText[]): Map<string, Breadth> {
  const typescript = sources.filter((source) => source.language === "typescript");
  const python = sources.filter((source) => source.language === "python");
  const uses = new UseCounter();
  countTypescriptUses(typescript, uses);
  countPythonUses(python, uses);
  const breadth = new Map<string, Breadth>();
  for (const source of [...typescript, ...python]) {
    breadth.set(source.path, uses.breadthOf(source.path));
  }
  return breadth;
}

class UseCounter {
  private readonly exported = new Map<string, Set<string>>();
  private readonly usedNames = new Map<string, Set<string>>();
  private readonly users = new Map<string, Set<string>>();

  declareExports(file: string, names: string[]): void {
    this.exported.set(file, new Set(names));
  }

  exportsOf(file: string): string[] {
    return [...(this.exported.get(file) ?? [])];
  }

  record(user: string, target: string, names: string[]): void {
    if (user === target) {
      return;
    }
    const exported = this.exported.get(target) ?? new Set<string>();
    const real = names.filter((name) => exported.has(name));
    if (real.length === 0) {
      return;
    }
    addAll(this.usedNames, target, real);
    addAll(this.users, target, [user]);
  }

  breadthOf(file: string): Breadth {
    return {
      namesUsedOutside: [...(this.usedNames.get(file) ?? [])].sort(),
      filesUsingIt: [...(this.users.get(file) ?? [])].sort(),
    };
  }
}

function addAll(map: Map<string, Set<string>>, key: string, values: string[]): void {
  const set = map.get(key) ?? new Set<string>();
  for (const value of values) {
    set.add(value);
  }
  map.set(key, set);
}

// TypeScript and JavaScript ------------------------------------------------------------------------

const resolvableExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];

function countTypescriptUses(sources: SourceText[], uses: UseCounter): void {
  const modules = new TypescriptModuleIndex(sources.map((source) => source.path));
  for (const source of sources) {
    uses.declareExports(source.path, exportedNamesOf(source.text));
  }
  for (const source of sources) {
    for (const use of moduleUsesOf(source.text)) {
      const target = modules.resolve(source.path, use.specifier);
      if (target !== undefined) {
        uses.record(source.path, target, use.usesAllNames ? uses.exportsOf(target) : use.names);
      }
    }
  }
}

class TypescriptModuleIndex {
  private readonly files: Set<string>;
  private readonly bySuffix: SuffixIndex;

  constructor(paths: string[]) {
    this.files = new Set(paths);
    this.bySuffix = new SuffixIndex();
    for (const file of paths) {
      const withoutExtension = file.replace(/\.[^./]+$/, "");
      this.bySuffix.add(withoutExtension.split("/"), file);
      if (/(^|\/)index$/.test(withoutExtension)) {
        this.bySuffix.add(withoutExtension.split("/").slice(0, -1), file);
      }
    }
  }

  resolve(importer: string, specifier: string): string | undefined {
    if (specifier.startsWith(".")) {
      return this.resolveRelative(importer, specifier);
    }
    return this.resolveBySuffix(importer, specifier);
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

  // An alias like "@/lib/x" or "~/lib/x" points into the repo: its path after the alias is matched
  // against the end of the repo's paths. A bare name ("react", "fs") is a package, not a file of
  // the repo, so a one-part suffix counts only after such an alias.
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

function countPythonUses(sources: SourceText[], uses: UseCounter): void {
  const modules = new PythonModuleIndex(sources.map((source) => source.path));
  for (const source of sources) {
    uses.declareExports(source.path, publicNamesOf(source.text, source.path === "__init__.py" || source.path.endsWith("/__init__.py")));
  }
  for (const source of sources) {
    for (const pythonImport of importsOf(source.text)) {
      const target = modules.resolve(source.path, pythonImport.module);
      if (target === undefined) {
        continue;
      }
      const names = pythonImport.usesAllNames ? uses.exportsOf(target) : [...pythonImport.importedNames, ...pythonImport.attributesUsed];
      uses.record(source.path, target, names);
    }
  }
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
  const rest = relative.slice(dots);
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
  // picking one would count a use that may belong to the other.
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
