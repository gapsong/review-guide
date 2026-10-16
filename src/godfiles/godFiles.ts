import { execFile, spawn } from "child_process";
import { Breadth, measureBreadth, SourceText } from "./breadth";
import { countCodeLines, globToRegExp, isMeasuredSource, languageOf } from "./sourceFiles";

// Where owning a repo hurts most: its files ranked by breadth (names other files use) and by
// reasons to change (history), never by length. The owner's rule: a big file is fine only as a
// well-designed deep module.
//
//   HEAD ── git ls-tree + cat-file ──► source files ──► code lines, breadth (imports)
//   HEAD ── one git log pass ────────► commits, co-change areas
//                                       └──► candidates (≥ minCodeLines) ──► score ──► report
//
// Deterministic and read-only: only HEAD and its history count, never the working tree, and git
// never touches the network (readGit). No Claude, no language server.

// Every threshold of the God Files view, so each one is switched in one place (README, "God files").
export const godFileRules = {
  // More names used by other files than this, and the file's interface is broad.
  broadAboveNamesUsedOutside: 7,
  // A file with a narrow interface is called a deep module only from this many code lines on;
  // a short file with a narrow interface is just a small file.
  deepFromCodeLines: 300,
  // A deep module has one reason to change. A file whose commits also touch files of more areas than
  // this changes for more reasons than one, so it gets no deep hint however narrow it is. Calibrated
  // on fastapi (routing.py, applications.py: 1 area) and vscode-pull-request-github (its narrow
  // 1,000-line files change with 5 to 10 areas); see REPORT.md.
  deepAtMostCoChangeAreas: 3,
  // A commit that touches more files than this is a sweep (a rename, a formatter run); its files did
  // not change together for one reason, so it does not count as co-change.
  largestCoChangeCommitFiles: 25,
};

// The settings' defaults (package.json, reviewGuide.godFiles.*).
export const godFileDefaults = {
  days: 90,
  minCodeLines: 150,
  maxItems: 20,
};

export interface GodFileOptions {
  days: number;
  minCodeLines: number;
  // Globs of repo paths to leave out (setting reviewGuide.godFiles.exclude).
  exclude: string[];
}

export type GodFileHint = "god file?" | "deep" | undefined;

export interface GodFileItem {
  path: string;
  codeLines: number;
  // undefined: breadth is not measured for this language (shown as "–", never as 0). Top-level names
  // and public class members as "Class.member" (breadth.ts, isClassMember).
  namesUsedOutside: string[] | undefined;
  filesUsingIt: string[] | undefined;
  commits: number;
  // The areas (areaOf) of the other measured source files changed in the same commits, sorted.
  coChangeAreas: string[];
  // 0 to 1: the mean of the file's percentiles on names used outside, co-change areas and commits.
  score: number;
  hint: GodFileHint;
}

export interface GodFileReport {
  commit: string;
  days: number;
  minCodeLines: number;
  sourceFileCount: number;
  // Commits in the window before HEAD, merges left out.
  commitCount: number;
  // A shallow clone holds only the newest commits: the counts are a floor, not the history.
  historyIsCut: boolean;
  // Every candidate, the highest score first.
  items: GodFileItem[];
}

export const defaultGodFileOptions: GodFileOptions = { days: godFileDefaults.days, minCodeLines: godFileDefaults.minCodeLines, exclude: [] };

export async function measureGodFiles(repoFolder: string, options: GodFileOptions): Promise<GodFileReport> {
  const commit = await headCommitOf(repoFolder);
  const sourcePaths = await measuredSourcesAt(repoFolder, commit, options);
  const sources = await readSources(repoFolder, sourcePaths);
  const breadth = measureBreadth(sources);
  const history = await readHistory(repoFolder, commit, options.days, new Set(sourcePaths.map((file) => file.path)));
  const historyIsCut = (await readGit(repoFolder, ["rev-parse", "--is-shallow-repository"])).trim() === "true";
  const candidates = sources
    .map((source) => ({ path: source.path, codeLines: countCodeLines(source.text, source.language) }))
    .filter((source) => source.codeLines >= options.minCodeLines)
    .map((source) => candidateOf(source.path, source.codeLines, breadth.get(source.path), history.files.get(source.path)));
  return {
    commit,
    days: options.days,
    minCodeLines: options.minCodeLines,
    sourceFileCount: sources.length,
    commitCount: history.commitCount,
    historyIsCut,
    items: ranked(candidates),
  };
}

// Only a hint: Claude's verdict (Judge with Claude) is the real judgment. A file whose breadth is
// not known gets no hint, because no hint is better than a wrong one. "deep" needs all three: a
// narrow interface (class members included), enough code to hide, and few reasons to change. A file
// nobody imports (an entry point, or unused) has no interface to be deep behind.
export function hintOf(namesUsedOutside: number | undefined, codeLines: number, coChangeAreas: number): GodFileHint {
  if (namesUsedOutside === undefined) {
    return undefined;
  }
  if (isBroad(namesUsedOutside)) {
    return "god file?";
  }
  const isDeep = namesUsedOutside >= 1 && codeLines >= godFileRules.deepFromCodeLines && coChangeAreas <= godFileRules.deepAtMostCoChangeAreas;
  return isDeep ? "deep" : undefined;
}

export function isBroad(namesUsedOutside: number): boolean {
  return namesUsedOutside > godFileRules.broadAboveNamesUsedOutside;
}

// Folders that only hold other parts: in a monorepo, apps/web and apps/api are two areas, not one.
const containerFolders = new Set(["apps", "packages", "libs", "services", "src", "modules", "crates", "internal", "pkg", "cmd"]);

// The area of a repo path: its first folder, or its first two when the first is a container folder.
// A file directly in the repo root, or directly in a container folder, is in the area of that folder.
export function areaOf(repoPath: string): string {
  const folders = repoPath.split("/").slice(0, -1);
  if (folders.length === 0) {
    return ".";
  }
  return containerFolders.has(folders[0]) && folders.length >= 2 ? `${folders[0]}/${folders[1]}` : folders[0];
}

type Candidate = Omit<GodFileItem, "score">;

function candidateOf(path: string, codeLines: number, breadth: Breadth | undefined, history: FileHistory | undefined): Candidate {
  const { commits, coChangeAreas } = history ?? { commits: 0, coChangeAreas: [] };
  return {
    path,
    codeLines,
    namesUsedOutside: breadth?.namesUsedOutside,
    filesUsingIt: breadth?.filesUsingIt,
    commits,
    coChangeAreas,
    hint: hintOf(breadth?.namesUsedOutside.length, codeLines, coChangeAreas.length),
  };
}

// The score: the mean of the candidate's percentile ranks among all candidates on three signals.
// Code lines are not a signal: the owner's rule says length alone never makes a god file. An unknown
// breadth is left out of the file's mean instead of counting as 0.
function ranked(candidates: Candidate[]): GodFileItem[] {
  const signals = candidates.map((candidate) => [candidate.namesUsedOutside?.length, candidate.coChangeAreas.length, candidate.commits]);
  const items = candidates.map((candidate, index) => {
    const percentiles = signals[index].flatMap((value, signal) => {
      const known = signals.map((other) => other[signal]).filter((other): other is number => other !== undefined);
      return value === undefined ? [] : [percentileOf(value, known)];
    });
    return { ...candidate, score: percentiles.reduce((sum, value) => sum + value, 0) / percentiles.length };
  });
  return items.sort((first, second) => second.score - first.score || first.path.localeCompare(second.path));
}

// The midrank percentile: how many values are below, plus half of the equal ones (itself included).
function percentileOf(value: number, values: number[]): number {
  const below = values.filter((other) => other < value).length;
  const equal = values.filter((other) => other === value).length;
  return (below + equal / 2) / values.length;
}

async function headCommitOf(repoFolder: string): Promise<string> {
  try {
    return (await readGit(repoFolder, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"])).trim();
  } catch {
    throw new Error("The workspace folder has no commit yet, so there is no history to measure.");
  }
}

interface TrackedFile {
  path: string;
  objectId: string;
}

// Regular files at HEAD only: a symbolic link or a submodule holds no code of this repo.
async function measuredSourcesAt(repoFolder: string, commit: string, options: GodFileOptions): Promise<TrackedFile[]> {
  const excludeGlobs = options.exclude.map(globToRegExp);
  const tree = await readGit(repoFolder, ["ls-tree", "-r", "-z", "--full-tree", commit]);
  const files: TrackedFile[] = [];
  for (const line of tree.split("\0")) {
    const match = /^(\d+) blob (\S+)\t(.*)$/s.exec(line);
    if (match && match[1] !== "120000" && isMeasuredSource(match[3], excludeGlobs)) {
      files.push({ path: match[3], objectId: match[2] });
    }
  }
  return files;
}

async function readSources(repoFolder: string, files: TrackedFile[]): Promise<SourceText[]> {
  const blobs = await readBlobs(repoFolder, files.map((file) => file.objectId));
  return files.map((file, index) => ({ path: file.path, language: languageOf(file.path)!, text: blobs[index].toString("utf8") }));
}

// History ------------------------------------------------------------------------------------------
//
// Reasons to change, from ONE git log pass over the window before HEAD:
//
//   commit ─┬─ checkout.py ┐
//           ├─ payment.py  ├─ changed together: each counts the other's area
//           └─ README.md   ┘  (only measured source files count)
//
// A commit with more than godFileRules.largestCoChangeCommitFiles files is a sweep: it still counts
// as a commit of each file, but its files did not change together.
//
// The window ends at HEAD's commit time, not at the clock: the numbers belong to the commit, and a
// test repo gives the same numbers every day.

interface FileHistory {
  commits: number;
  coChangeAreas: string[];
}

export interface Commit {
  // Paths as they are at HEAD: a file renamed later in history counts under its new path.
  paths: string[];
}

async function readHistory(repoFolder: string, headCommit: string, days: number, measuredPaths: Set<string>): Promise<{ commitCount: number; files: Map<string, FileHistory> }> {
  const headTimeSeconds = Number((await readGit(repoFolder, ["show", "-s", "--format=%ct", headCommit])).trim());
  const since = `--since=@${headTimeSeconds - days * 24 * 60 * 60}`;
  const commits = parseLog(await readGit(repoFolder, ["log", "--no-merges", "-z", "--name-status", "-M", "--format=%x1e%H", since, headCommit]));
  return { commitCount: commits.length, files: historyOf(commits, measuredPaths) };
}

// The log, newest first. A rename ("R100 old new") maps the old path to the new one for every
// older commit, so a file keeps its history across a move.
export function parseLog(log: string): Commit[] {
  const currentPathOf = new Map<string, string>();
  return log.split("\x1e").slice(1).map((record) => {
    const fields = record.split("\0").slice(1).map((field) => field.replace(/^\n/, "")).filter((field) => field !== "");
    const paths = new Set<string>();
    for (let i = 0; i < fields.length;) {
      const status = fields[i];
      if (status.startsWith("R") || status.startsWith("C")) {
        const [oldPath, newPath] = [fields[i + 1], fields[i + 2]];
        const current = currentPathOf.get(newPath) ?? newPath;
        if (status.startsWith("R")) {
          currentPathOf.set(oldPath, current);
        }
        paths.add(current);
        i += 3;
      } else {
        paths.add(currentPathOf.get(fields[i + 1]) ?? fields[i + 1]);
        i += 2;
      }
    }
    return { paths: [...paths] };
  });
}

export function historyOf(commits: Commit[], measuredPaths: Set<string>): Map<string, FileHistory> {
  const counts = new Map<string, { commits: number; partners: Set<string> }>();
  for (const commit of commits) {
    const measured = commit.paths.filter((filePath) => measuredPaths.has(filePath));
    const isSweep = commit.paths.length > godFileRules.largestCoChangeCommitFiles;
    for (const filePath of measured) {
      const count = counts.get(filePath) ?? { commits: 0, partners: new Set<string>() };
      count.commits++;
      for (const partner of isSweep ? [] : measured) {
        if (partner !== filePath) {
          count.partners.add(partner);
        }
      }
      counts.set(filePath, count);
    }
  }
  return new Map([...counts].map(([filePath, count]) => [filePath, { commits: count.commits, coChangeAreas: [...new Set([...count.partners].map(areaOf))].sort() }]));
}

// Git ----------------------------------------------------------------------------------------------
//
// Git for the measurement reads, and it can never reach the network: protocol.allow=never refuses
// every transport, and GIT_NO_LAZY_FETCH stops a partial clone from fetching a missing object, which
// would write into the repo's .git; a missing object is an error instead.

const readOnlyEnvironment = { GIT_TERMINAL_PROMPT: "0", GIT_NO_LAZY_FETCH: "1", GIT_OPTIONAL_LOCKS: "0" };
const readOnlyConfig = ["-c", "protocol.allow=never"];

function readGit(repoFolder: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const options = { cwd: repoFolder, env: { ...process.env, ...readOnlyEnvironment }, maxBuffer: 1024 * 1024 * 1024 };
    execFile("git", [...readOnlyConfig, ...args], options, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`git ${args.join(" ")} failed: ${stderr.trim() || error.message}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

// The content of many blobs in one git process: "git cat-file --batch" answers each object id on
// stdin with "<id> blob <size>\n<content>\n".
function readBlobs(repoFolder: string, objectIds: string[]): Promise<Buffer[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", [...readOnlyConfig, "cat-file", "--batch"], { cwd: repoFolder, env: { ...process.env, ...readOnlyEnvironment } });
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.on("error", (error) => reject(new Error(`git cat-file could not run: ${error.message}`)));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`git cat-file failed with exit code ${code}: ${Buffer.concat(errors).toString("utf8").trim()}`));
        return;
      }
      const output = Buffer.concat(chunks);
      const blobs: Buffer[] = [];
      let offset = 0;
      for (const id of objectIds) {
        const headerEnd = output.indexOf(0x0a, offset);
        const size = Number(/^\S+ blob (\d+)$/.exec(output.subarray(offset, headerEnd).toString("utf8"))?.[1]);
        if (Number.isNaN(size)) {
          reject(new Error(`git cat-file did not return the file ${id}.`));
          return;
        }
        blobs.push(output.subarray(headerEnd + 1, headerEnd + 1 + size));
        offset = headerEnd + 1 + size + 1;
      }
      resolve(blobs);
    });
    child.stdin.end(objectIds.map((id) => `${id}\n`).join(""));
  });
}
