import { importLinesOf } from "./imports";
import { languageOf } from "./sourceFiles";

// Breadth: how many of a file's names other source files use, as the language server finds them
// ("Find All References"). Only the files the God Files view shows are measured, after the
// ranking is up:
//
//   document symbols ──► top-level names, public class members as "Class.member"
//        │
//        └─ references of each ──► in another measured source file, not on an import line? ──► used outside
//
// A barrel (index.ts, a package's __init__.py) declares nothing of its own when it only re-exports:
// a symbol on an import or re-export line is not the file's. The module that defines a name gets
// its uses, because the language server follows a re-export to the definition. A reference on an
// import line names the thing without using it, so a barrel does not count as a user either.

// What the language server tells about one file. Lines and characters are 0-based.
export interface LanguageServer {
  // undefined: no document symbol provider for the file's language.
  symbols(repoPath: string): Promise<SymbolNode[] | undefined>;
  // Resolves when the server answers for its whole project, not only for the open files: while a
  // TypeScript project loads, VS Code answers references from open files alone.
  ready(repoPath: string): Promise<void>;
  // Every place that refers to the symbol at the position, its declaration included; an empty list
  // means no reference provider answered. path is undefined for a place outside the repo.
  references(repoPath: string, line: number, character: number): Promise<{ path: string | undefined; line: number }[]>;
  // The file's current text: its import lines and member modifiers.
  text(repoPath: string): Promise<string>;
}

export interface SymbolNode {
  name: string;
  isClass: boolean;
  line: number;
  character: number;
  children: SymbolNode[];
}

export type Breadth =
  | { state: "pending" }
  | { state: "unknown"; reason: string }
  // names: sorted, "Class.member" for class members. complete is false when the count stopped
  // above the broad threshold (shown as "8+"). files: the other files using any of them.
  | { state: "known"; names: string[]; files: string[]; complete: boolean };

export interface BreadthOptions {
  // Repo paths whose references count: the measured source files (tests are not users).
  measured: Set<string>;
  // Stop counting once more names than this are used outside: the file is broad either way.
  stopAbove: number;
  timeoutMilliseconds: number;
  isCancelled: () => boolean;
}

// undefined when cancelled.
export async function measureBreadth(repoPath: string, server: LanguageServer, options: BreadthOptions): Promise<Breadth | undefined> {
  const deadline = Date.now() + options.timeoutMilliseconds;
  const inTime = <T>(work: Promise<T>) => beforeDeadline(work, deadline);
  const importLinesByFile = new Map<string, Promise<Set<number>>>();
  const importLines = (file: string) => {
    const lines = importLinesByFile.get(file) ?? inTime(server.text(file)).then((text) => importLinesOf(text, languageOf(file) ?? "other"));
    importLinesByFile.set(file, lines);
    return lines;
  };
  try {
    const symbols = await inTime(server.symbols(repoPath));
    if (symbols === undefined) {
      return { state: "unknown", reason: `No language server answers document symbols for ${languageName(repoPath)} files here.` };
    }
    await inTime(server.ready(repoPath));
    const lines = (await inTime(server.text(repoPath))).split(/\r?\n/);
    const names = new Map<string, Set<string>>();
    for (const declaration of declarationsOf(symbols, lines, await importLines(repoPath))) {
      if (options.isCancelled()) {
        return undefined;
      }
      const references = await inTime(server.references(repoPath, declaration.line, declaration.character));
      if (references.length === 0) {
        return { state: "unknown", reason: `No language server answers references for ${languageName(repoPath)} files here.` };
      }
      for (const reference of references) {
        if (reference.path !== undefined && reference.path !== repoPath && options.measured.has(reference.path) && !(await importLines(reference.path)).has(reference.line)) {
          names.set(declaration.name, (names.get(declaration.name) ?? new Set<string>()).add(reference.path));
        }
      }
      if (names.size > options.stopAbove) {
        return known(names, false);
      }
    }
    return known(names, true);
  } catch (error) {
    const reason = error instanceof TimeoutError
      ? `The language server did not answer within ${Math.round(options.timeoutMilliseconds / 1000)} s.`
      : `The language server failed: ${error instanceof Error ? error.message : String(error)}`;
    return { state: "unknown", reason };
  }
}

function known(names: Map<string, Set<string>>, complete: boolean): Breadth {
  const files = new Set([...names.values()].flatMap((users) => [...users]));
  return { state: "known", names: [...names.keys()].sort(), files: [...files].sort(), complete };
}

interface Declaration {
  name: string;
  line: number;
  character: number;
}

// Top-level declarations and the public members of top-level classes. Private, protected, "#" and
// "_" names, constructors and anything on an import or re-export line are left out.
function declarationsOf(symbols: SymbolNode[], lines: string[], importLines: Set<number>): Declaration[] {
  const isOwn = (symbol: SymbolNode) => !importLines.has(symbol.line) && !/^[_#]/.test(symbol.name) && symbol.name !== "constructor";
  const declarations: Declaration[] = [];
  for (const symbol of symbols.filter(isOwn)) {
    declarations.push({ name: symbol.name, line: symbol.line, character: symbol.character });
    if (symbol.isClass) {
      for (const member of symbol.children.filter(isOwn).filter((child) => !isHidden(child, lines))) {
        declarations.push({ name: `${symbol.name}.${member.name}`, line: member.line, character: member.character });
      }
    }
  }
  return declarations;
}

// "private x", "protected get y()": the modifier stands before the name on its line.
function isHidden(member: SymbolNode, lines: string[]): boolean {
  return /\b(private|protected)\b/.test((lines[member.line] ?? "").slice(0, member.character));
}

// "Model.create" is a class member; "create" is a top-level name.
export function isClassMember(nameUsedOutside: string): boolean {
  return nameUsedOutside.includes(".");
}

function languageName(repoPath: string): string {
  const language = languageOf(repoPath);
  return language === "typescript" ? "TypeScript/JavaScript" : language === "python" ? "Python" : `"${/\.[^./]+$/.exec(repoPath)?.[0] ?? repoPath}"`;
}

class TimeoutError extends Error {}

function beforeDeadline<T>(work: Promise<T>, deadline: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError()), Math.max(0, deadline - Date.now()));
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
