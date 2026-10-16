import * as path from "path";
import * as python from "./pythonModules";
import { Language } from "./sourceFiles";
import * as typescript from "./typescriptModules";
import { Reexport } from "./typescriptModules";

// Breadth: how many of a file's top-level names other source files use, and how many files use
// them. Users are found through their imports, resolved to files of the repo:
//
//   checkout.ts ──import { charge } from "@/shop/payment"──►  src/shop/payment.ts   (by path suffix)
//   views.py    ──from ..shop.payment import charge──────►   shop/payment.py       (relative)
//
// Only names the file really defines count: a name imported from it that it does not export is
// left out, so a wrong guess about an import never makes a file broader.
//
// A class's public members are names too: when a file imports the class and accesses .member, the
// member counts as "Class.member". Otherwise a class with forty public methods would pass as one
// name, and a broad class as a deep module.

export interface SourceText {
  path: string;
  language: Language;
  text: string;
}

export interface Breadth {
  // Names of the file that at least one other source file uses, sorted: top-level names, and public
  // class members as "Class.member" (isClassMember).
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

// "Model.create" is a class member; "create" is a top-level name.
export function isClassMember(nameUsedOutside: string): boolean {
  return nameUsedOutside.includes(".");
}

class UseCounter {
  private readonly exported = new Map<string, Set<string>>();
  private readonly classMembers = new Map<string, Map<string, string[]>>();
  private readonly usedNames = new Map<string, Set<string>>();
  private readonly users = new Map<string, Set<string>>();
  private readonly namedReexports = new Map<string, Map<string, { target: string; importedName: string }>>();
  private readonly starReexports = new Map<string, string[]>();

  declareExports(file: string, names: string[], classMembers: Map<string, string[]>): void {
    this.exported.set(file, new Set(names));
    this.classMembers.set(file, classMembers);
  }

  declareReexports(file: string, target: string, reexported: Reexport[] | undefined, reexportsAll: boolean | undefined): void {
    const named = this.namedReexports.get(file) ?? new Map<string, { target: string; importedName: string }>();
    for (const entry of reexported ?? []) {
      named.set(entry.exportedAs, { target, importedName: entry.importedName });
    }
    this.namedReexports.set(file, named);
    if (reexportsAll) {
      this.starReexports.set(file, [...(this.starReexports.get(file) ?? []), target]);
    }
  }

  exportsOf(file: string): string[] {
    return [...(this.exported.get(file) ?? [])];
  }

  // membersAccessed: every .<name> the user file accesses; of an imported class, the public members
  // among them count. Re-exports are followed: a name imported from a barrel (index.ts, a package's
  // __init__.py) is also a use of the module that defines it; visited stops a cycle of barrels.
  record(user: string, target: string, names: string[], membersAccessed: Set<string>, visited = new Set<string>()): void {
    if (user === target || visited.has(target)) {
      return;
    }
    visited.add(target);
    const exported = this.exported.get(target) ?? new Set<string>();
    const real = names.filter((name) => exported.has(name));
    if (real.length > 0) {
      const members = real.flatMap((name) => (this.classMembers.get(target)?.get(name) ?? []).filter((member) => membersAccessed.has(member)).map((member) => `${name}.${member}`));
      addAll(this.usedNames, target, [...real, ...members]);
      addAll(this.users, target, [user]);
    }
    for (const name of names) {
      const reexport = this.namedReexports.get(target)?.get(name);
      if (reexport) {
        this.record(user, reexport.target, [reexport.importedName], membersAccessed, new Set(visited));
      }
      for (const starTarget of this.starReexports.get(target) ?? []) {
        if (this.exported.get(starTarget)?.has(name) || this.namedReexports.get(starTarget)?.has(name) || this.starReexports.has(starTarget)) {
          this.record(user, starTarget, [name], membersAccessed, new Set(visited));
        }
      }
    }
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
  const resolvedUses = sources.map((source) => ({
    source,
    uses: typescript.moduleUsesOf(source.text).map((use) => ({ use, target: modules.resolve(source.path, use.specifier) })),
    membersAccessed: typescript.membersAccessed(source.text),
  }));
  for (const { source, uses: fileUses } of resolvedUses) {
    uses.declareExports(source.path, typescript.exportedNamesOf(source.text), typescript.classMembersOf(source.text));
    for (const { use, target } of fileUses) {
      if (target !== undefined) {
        uses.declareReexports(source.path, target, use.reexported, use.reexportsAll);
      }
    }
  }
  for (const { source, uses: fileUses, membersAccessed } of resolvedUses) {
    for (const { use, target } of fileUses) {
      if (target !== undefined) {
        uses.record(source.path, target, use.usesAllNames ? uses.exportsOf(target) : use.names, membersAccessed);
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
  const resolvedImports = sources.map((source) => ({
    source,
    isPackageInit: source.path === "__init__.py" || source.path.endsWith("/__init__.py"),
    imports: python.importsOf(source.text).map((pythonImport) => ({ pythonImport, target: modules.resolve(source.path, pythonImport.module) })),
    membersAccessed: python.membersAccessed(source.text),
  }));
  for (const { source, isPackageInit, imports } of resolvedImports) {
    uses.declareExports(source.path, python.publicNamesOf(source.text, isPackageInit), python.classMembersOf(source.text));
    for (const { pythonImport, target } of imports) {
      if (target !== undefined && isPackageInit) {
        uses.declareReexports(source.path, target, pythonImport.reexported, pythonImport.reexportsAll);
      }
    }
  }
  for (const { source, imports, membersAccessed } of resolvedImports) {
    for (const { pythonImport, target } of imports) {
      if (target !== undefined) {
        const names = pythonImport.usesAllNames ? uses.exportsOf(target) : [...pythonImport.importedNames, ...pythonImport.attributesUsed];
        uses.record(source.path, target, names, membersAccessed);
      }
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
