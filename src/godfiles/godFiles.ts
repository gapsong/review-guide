import { execFile, spawn } from "child_process";
import { Breadth } from "./breadth";
import { Complexity } from "./complexity";
import { importedFiles, ScannedSource } from "./imports";
import { countCodeLines, globToRegExp, isMeasuredSource, languageOf } from "./sourceFiles";

// Where owning a repo hurts most: its files ranked by reasons to change (history) and by how much
// of the repo they know (imports), never by length. The owner's rule: a big file is fine only as a
// well-designed deep module.
//
//   HEAD ── git ls-tree + cat-file ──► source files ──► code lines, areas it imports from (imports.ts)
//   HEAD ── one git log pass ────────► commits, co-change areas
//                                       └──► candidates (≥ minCodeLines) ──► score ──► report
//
// Deterministic and read-only: only HEAD and its history count, never the working tree, and git
// never touches the network (readGit). No Claude, no language server. Breadth (names used outside,
// from the language server) and cognitive complexity come later, for the files the view shows.

// Every threshold of the God Files view, so each one is switched in one place (README, "God files").
export const godFileRules = {
  // More names used by other files than this, and the file's interface is broad. Counting names
  // stops there (shown as "8+").
  broadAboveNamesUsedOutside: 7,
  // A file with a narrow interface is called a deep module only from this many code lines on;
  // a short file with a narrow interface is just a small file.
  deepFromCodeLines: 300,
  // A deep module has one reason to change. A file whose commits also touch files of more areas than
  // this changes for more reasons than one, so it gets no deep hint however narrow it is. Calibrated
  // on fastapi (routing.py, applications.py: 1 area) and vscode-pull-request-github (its narrow
  // 1,000-line files change with 5 to 10 areas); see REPORT.md.
  deepAtMostCoChangeAreas: 3,
  // A deep module hides its work behind a narrow interface, and it needs little of the rest of the
  // repo to do it. A file that imports from more other areas than this knows too much for one
  // reason to change (assumption, reversible).
  deepAtMostKnownAreas: 3,
  // A commit that touches more files than this is a sweep (a rename, a formatter run); its files did
  // not change together for one reason, so it does not count as co-change.
  largestCoChangeCommitFiles: 25,
  // The history window before HEAD: each commit in it is a reason the file had to change.
  days: 90,
};

export interface GodFileOptions {
  // Files are candidates from this many code lines on (setting reviewGuide.godFiles.minLines).
  minCodeLines: number;
  // Globs of repo paths to leave out (setting reviewGuide.godFiles.exclude).
  exclude: string[];
}

export type GodFileHint = "god file?" | "deep" | undefined;

export interface GodFileItem {
  path: string;
  codeLines: number;
  commits: number;
  // The other areas (areaRuleFor) of the measured source files changed in the same commits, sorted.
  coChangeAreas: string[];
  // The other areas whose files this file imports, sorted.
  knownAreas: string[];
  // The other measured files that import this one, sorted: when the language server finds no use of
  // its names, they show the use is dynamic (m.router over a list of modules), not missing.
  importedBy: string[];
  // 0 to 1: the mean of the file's percentiles on known areas, co-change areas and commits.
  score: number;
  // Measured by the view, from the language server, for the files it shows; "pending" until then.
  breadth: Breadth;
  complexity: Complexity;
}

export interface GodFileReport {
  commit: string;
  minCodeLines: number;
  // Every measured source file: the files whose uses of a name count (tests are not users).
  sourcePaths: string[];
  // Commits in the window before HEAD, merges left out.
  commitCount: number;
  // A shallow clone holds only the newest commits: the counts are a floor, not the history.
  historyIsCut: boolean;
  // Every candidate, the highest score first.
  items: GodFileItem[];
}

export const defaultGodFileOptions: GodFileOptions = { minCodeLines: 150, exclude: [] };

export async function measureGodFiles(repoFolder: string, options: GodFileOptions): Promise<GodFileReport> {
  const commit = await headCommitOf(repoFolder);
  const sourcePaths = await measuredSourcesAt(repoFolder, commit, options);
  const sources = await readSources(repoFolder, sourcePaths);
  const imports = importedFiles(sources);
  const importers = new Map<string, string[]>();
  for (const [importer, targets] of imports) {
    for (const target of targets) {
      importers.set(target, [...(importers.get(target) ?? []), importer]);
    }
  }
  const history = await readHistory(repoFolder, commit, new Set(sourcePaths.map((file) => file.path)));
  const historyIsCut = (await readGit(repoFolder, ["rev-parse", "--is-shallow-repository"])).trim() === "true";
  const areaOf = areaRuleFor(sourcePaths.map((file) => file.path));
  const candidates = sources
    .map((source) => ({ path: source.path, codeLines: countCodeLines(source.text, source.language) }))
    .filter((source) => source.codeLines >= options.minCodeLines)
    .map((source) => candidateOf(source.path, source.codeLines, { imports: imports.get(source.path) ?? [], importedBy: importers.get(source.path) ?? [] }, history.files.get(source.path), areaOf));
  return {
    commit,
    minCodeLines: options.minCodeLines,
    sourcePaths: sources.map((source) => source.path),
    commitCount: history.commitCount,
    historyIsCut,
    items: ranked(candidates),
  };
}

// Only a hint: Claude's verdict (Judge with Claude) is the real judgment. A file whose breadth is
// not known (yet) gets no hint, because no hint is better than a wrong one. "deep" needs all four:
// a narrow interface (members included), enough code to hide, few reasons to change and
// little knowledge of other areas. A file nobody uses (an entry point, or unused) has no interface
// to be deep behind.
export function hintOf(item: Pick<GodFileItem, "breadth" | "codeLines" | "coChangeAreas" | "knownAreas">): GodFileHint {
  if (item.breadth.state !== "known") {
    return undefined;
  }
  const names = item.breadth.names.length;
  if (isBroad(names)) {
    return "god file?";
  }
  const isDeep = names >= 1
    && item.codeLines >= godFileRules.deepFromCodeLines
    && item.coChangeAreas.length <= godFileRules.deepAtMostCoChangeAreas
    && item.knownAreas.length <= godFileRules.deepAtMostKnownAreas;
  return isDeep ? "deep" : undefined;
}

export function isBroad(namesUsedOutside: number): boolean {
  return namesUsedOutside > godFileRules.broadAboveNamesUsedOutside;
}

// Root folders that only hold other parts: in a monorepo, apps/web and apps/api are two areas.
const containerFolders = new Set(["apps", "packages", "libs", "services", "modules", "crates", "internal", "pkg", "cmd"]);

// The area of a repo path: the first folder that has sibling folders, after skipping a container
// folder at the root together with its child, any `src`, and any folder that is the only folder
// in its parent (the Python src layout, src/<package>/). Siblings count over the measured source
// files, so test folders do not split an area. A file directly in the folder where the skipping
// stops is in that folder's area; a file in the repo root is in ".".
//
//   apps/api/src/shop_api/orders/service.py ──► apps/api/src/shop_api/orders
//   ╰container╯ ╰src╯ ╰only one╯ ╰siblings╯
export function areaRuleFor(sourcePaths: string[]): (repoPath: string) => string {
  const childFolders = new Map<string, Set<string>>();
  for (const sourcePath of sourcePaths) {
    const folders = sourcePath.split("/").slice(0, -1);
    folders.forEach((folder, index) => {
      const parent = folders.slice(0, index).join("/");
      childFolders.set(parent, (childFolders.get(parent) ?? new Set()).add(folder));
    });
  }
  return (repoPath) => {
    const folders = repoPath.split("/").slice(0, -1);
    let index = containerFolders.has(folders[0]) && folders.length >= 2 ? 2 : 0;
    while (index < folders.length && (folders[index] === "src" || childFolders.get(folders.slice(0, index).join("/"))?.size === 1)) {
      index++;
    }
    return folders.slice(0, index + 1).join("/") || ".";
  };
}

type Candidate = Omit<GodFileItem, "score">;

// Both counts leave out the file's own area: a sibling that changes with it, or that it imports, is
// the same reason to change.
function candidateOf(path: string, codeLines: number, imports: { imports: string[]; importedBy: string[] }, history: FileHistory | undefined, areaOf: (repoPath: string) => string): Candidate {
  const { commits, partners } = history ?? { commits: 0, partners: [] };
  const otherAreas = (paths: string[]) => [...new Set(paths.map(areaOf))].filter((area) => area !== areaOf(path)).sort();
  return { path, codeLines, commits, coChangeAreas: otherAreas(partners), knownAreas: otherAreas(imports.imports), importedBy: [...imports.importedBy].sort(), breadth: { state: "pending" }, complexity: { state: "pending" } };
}

// The score: the mean of the candidate's percentile ranks among all candidates on three signals,
// all from HEAD and its history, so the ranking is there at once and the same every time. Code
// lines are not a signal: the owner's rule says length alone never makes a god file.
function ranked(candidates: Candidate[]): GodFileItem[] {
  const signals = candidates.map((candidate) => [candidate.knownAreas.length, candidate.coChangeAreas.length, candidate.commits]);
  const items = candidates.map((candidate, index) => {
    const percentiles = signals[index].map((value, signal) => percentileOf(value, signals.map((other) => other[signal])));
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
  const noCommit = () => Promise.reject(new Error("The workspace folder has no commit yet, so there is no history to measure."));
  return (await readGit(repoFolder, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]).catch(noCommit)).trim();
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

// The texts of files at a commit, for the complexity tools (they never read the working tree). A
// path git cannot name (not at the commit, or not valid UTF-8 in the repo) is left out.
export async function readFilesAt(repoFolder: string, commit: string, repoPaths: string[]): Promise<{ path: string; text: string }[]> {
  const readable = repoPaths.filter((repoPath) => !repoPath.includes("\n"));
  const blobs = await readBlobs(repoFolder, readable.map((repoPath) => `${commit}:${repoPath}`));
  return readable.flatMap((repoPath, index) => (blobs[index] ? [{ path: repoPath, text: blobs[index].toString("utf8") }] : []));
}

async function readSources(repoFolder: string, files: TrackedFile[]): Promise<ScannedSource[]> {
  const blobs = await readBlobs(repoFolder, files.map((file) => file.objectId));
  return files.map((file, index) => ({ path: file.path, language: languageOf(file.path)!, text: blobs[index]?.toString("utf8") ?? "" }));
}

// History ------------------------------------------------------------------------------------------
//
// Reasons to change, from ONE git log pass over the window before HEAD:
//
//   commit ─┬─ checkout.py ┐
//           ├─ payment.py  ├─ changed together: each counts the other's area, if not its own
//           └─ README.md   ┘  (only measured source files count)
//
// A commit with more than godFileRules.largestCoChangeCommitFiles files is a sweep: it still counts
// as a commit of each file, but its files did not change together.
//
// The window ends at HEAD's commit time, not at the clock: the numbers belong to the commit, and a
// test repo gives the same numbers every day.

interface FileHistory {
  commits: number;
  // The other measured source files changed in the same commits.
  partners: string[];
}

// A commit's paths as they are at HEAD: a file renamed later in history counts under its new path.
interface Commit {
  paths: string[];
}

async function readHistory(repoFolder: string, headCommit: string, measuredPaths: Set<string>): Promise<{ commitCount: number; files: Map<string, FileHistory> }> {
  const headTimeSeconds = Number((await readGit(repoFolder, ["show", "-s", "--format=%ct", headCommit])).trim());
  const since = `--since=@${headTimeSeconds - godFileRules.days * 24 * 60 * 60}`;
  // A partial (blobless) clone lacks the old contents that finding an edited rename needs, and must
  // not fetch them, so there only exact renames count (seen on blobless clones of public repos).
  const isPartialClone = (await readGit(repoFolder, ["config", "--get-regexp", "^remote\\..*\\.promisor$"]).catch(() => "")).includes("true");
  const commits = parseLog(await readGit(repoFolder, ["log", "--no-merges", "-z", "--name-status", isPartialClone ? "-M100%" : "-M", "--format=%x1e%H", since, headCommit]));
  return { commitCount: commits.length, files: historyOf(commits, measuredPaths) };
}

// The log, newest first. A rename ("R100 old new") maps the old path to the new one for every
// older commit, so a file keeps its history across a move.
function parseLog(log: string): Commit[] {
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

function historyOf(commits: Commit[], measuredPaths: Set<string>): Map<string, FileHistory> {
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
  return new Map([...counts].map(([filePath, count]) => [filePath, { commits: count.commits, partners: [...count.partners] }]));
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

// The content of many blobs in one git process: "git cat-file --batch" answers each object on
// stdin with "<id> blob <size>\n<content>\n", or "<name> missing\n" (undefined here). An object can
// also be named "<commit>:<path>".
function readBlobs(repoFolder: string, objectNames: string[]): Promise<(Buffer | undefined)[]> {
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
      const blobs: (Buffer | undefined)[] = [];
      let offset = 0;
      for (let index = 0; index < objectNames.length; index++) {
        const headerEnd = output.indexOf(0x0a, offset);
        const header = headerEnd === -1 ? "" : output.subarray(offset, headerEnd).toString("utf8");
        const blob = / blob (\d+)$/.exec(header);
        if (!blob) {
          if (headerEnd === -1) {
            reject(new Error(`git cat-file answered ${index} of ${objectNames.length} objects.`));
            return;
          }
          blobs.push(undefined);
          offset = headerEnd + 1;
          continue;
        }
        const size = Number(blob[1]);
        blobs.push(output.subarray(headerEnd + 1, headerEnd + 1 + size));
        offset = headerEnd + 1 + size + 1;
      }
      resolve(blobs);
    });
    child.stdin.end(objectNames.map((name) => `${name}\n`).join(""));
  });
}
