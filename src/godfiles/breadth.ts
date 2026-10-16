import * as path from "path";
import * as python from "./pythonModules";
import { Language } from "./sourceFiles";
import * as typescript from "./typescriptModules";

// Breadth: how many of a file's names other source files use. Users are found through their imports, resolved to files of the repo:
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

// What one file takes from another module, as its language's parser reads it: the names it
// imports, or all of them (export *, from m import *). A re-export passes names on: "export { a as
// b } from" or a package's "from .m import a as b" offers a as b, and "export * from" offers all.
export interface ModuleUse {
  module: string;
  names: string[];
  usesAllNames: boolean;
  reexported?: Reexport[];
  reexportsAll?: boolean;
}

export interface Reexport {
  importedName: string;
  exportedAs: string;
}

export interface SourceText {
  path: string;
  language: Language;
  text: string;
}

// Breadth of every TypeScript/JavaScript and Python file: the names of the file that at least one
// other source file uses, sorted, top-level names and public class members as "Class.member"
// (isClassMember). Other languages are not in the map.
export function measureBreadth(sources: SourceText[]): Map<string, string[]> {
  const typescriptSources = sources.filter((source) => source.language === "typescript");
  const pythonSources = sources.filter((source) => source.language === "python");
  const uses = new UseCounter();
  countUses(typescriptSources, typescriptReader, new TypescriptModuleIndex(typescriptSources.map((source) => source.path)), uses);
  countUses(pythonSources, pythonReader, new PythonModuleIndex(pythonSources.map((source) => source.path)), uses);
  return new Map([...typescriptSources, ...pythonSources].map((source) => [source.path, uses.namesUsedOutside(source.path)]));
}

interface LanguageReader {
  exportedNames(source: SourceText): string[];
  classMembers(text: string): Map<string, string[]>;
  uses(source: SourceText): ModuleUse[];
  // Every .<name> the file accesses: the members it may use of the classes it imports.
  membersAccessed(text: string): Set<string>;
}

const isPackageInit = (file: string) => file === "__init__.py" || file.endsWith("/__init__.py");

const typescriptReader: LanguageReader = {
  exportedNames: (source) => typescript.exportedNamesOf(source.text),
  classMembers: typescript.classMembersOf,
  uses: (source) => typescript.moduleUsesOf(source.text),
  membersAccessed: typescript.membersAccessed,
};

// A package's __init__.py also offers what it imports at module level: that is the package's interface.
const pythonReader: LanguageReader = {
  exportedNames: (source) => python.publicNamesOf(source.text, isPackageInit(source.path)),
  classMembers: python.classMembersOf,
  uses: (source) => python.importsOf(source.text, isPackageInit(source.path)),
  membersAccessed: python.membersAccessed,
};

// Two passes: every file declares what it exports and re-exports, then every use is recorded.
function countUses(sources: SourceText[], reader: LanguageReader, modules: { resolve(importer: string, module: string): string | undefined }, uses: UseCounter): void {
  const files = sources.map((source) => ({
    source,
    resolved: reader.uses(source).map((use) => ({ use, target: modules.resolve(source.path, use.module) })).filter((entry): entry is { use: ModuleUse; target: string } => entry.target !== undefined),
    membersAccessed: reader.membersAccessed(source.text),
  }));
  for (const { source, resolved } of files) {
    uses.declareExports(source.path, reader.exportedNames(source), reader.classMembers(source.text));
    for (const { use, target } of resolved) {
      uses.declareReexports(source.path, target, use.reexported, use.reexportsAll);
    }
  }
  for (const { source, resolved, membersAccessed } of files) {
    for (const { use, target } of resolved) {
      uses.record(source.path, target, use.usesAllNames ? uses.exportsOf(target) : use.names, membersAccessed);
    }
  }
}

// "Model.create" is a class member; "create" is a top-level name.
export function isClassMember(nameUsedOutside: string): boolean {
  return nameUsedOutside.includes(".");
}

class UseCounter {
  private readonly exported = new Map<string, Set<string>>();
  private readonly classMembers = new Map<string, Map<string, string[]>>();
  private readonly usedNames = new Map<string, Set<string>>();
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
      const used = this.usedNames.get(target) ?? new Set<string>();
      [...real, ...members].forEach((name) => used.add(name));
      this.usedNames.set(target, used);
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

  namesUsedOutside(file: string): string[] {
    return [...(this.usedNames.get(file) ?? [])].sort();
  }
}

// TypeScript and JavaScript ------------------------------------------------------------------------

const resolvableExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];

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
