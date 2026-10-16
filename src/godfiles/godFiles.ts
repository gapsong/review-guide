import { Breadth, measureBreadth, SourceText } from "./breadth";
import { countCodeLines } from "./codeLines";
import { History, noHistory, readHistory } from "./history";
import { rankCandidates } from "./ranking";
import { readBlobs, readGit } from "./readOnlyGit";
import { GodFileHint, godFileDefaults, hintOf } from "./rules";
import { globToRegExp, isMeasuredSource, languageOf } from "./sourceFiles";

// Where owning a repo hurts most: its files ranked by breadth (names other files use) and by
// reasons to change (history), never by length. The owner's rule: a big file is fine only as a
// well-designed deep module.
//
//   HEAD ── git ls-tree + cat-file ──► source files ──► code lines, breadth (imports)
//   HEAD ── one git log pass ────────► commits, co-change areas
//                                       └──► candidates (≥ minCodeLines) ──► score ──► report
//
// Deterministic and read-only: only HEAD and its history count, never the working tree, and git
// never touches the network (readOnlyGit.ts). No Claude, no language server.

export interface GodFileOptions {
  days: number;
  minCodeLines: number;
  // Globs of repo paths to leave out (setting reviewGuide.godFiles.exclude).
  exclude: string[];
  signal?: AbortSignal;
}

export interface GodFileItem {
  path: string;
  codeLines: number;
  // undefined: breadth is not measured for this language (shown as "–", never as 0). Top-level names
  // and public class members as "Class.member" (breadth.ts, isClassMember).
  namesUsedOutside: string[] | undefined;
  filesUsingIt: string[] | undefined;
  commits: number;
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
  const commit = await headCommitOf(repoFolder, options.signal);
  const sourcePaths = await measuredSourcesAt(repoFolder, commit, options);
  const sources = await readSources(repoFolder, sourcePaths, options.signal);
  const breadth = measureBreadth(sources);
  const history = await readHistory(repoFolder, commit, options.days, new Set(sourcePaths.map((file) => file.path)), await isPartialClone(repoFolder), options.signal);
  const historyIsCut = (await readGit(repoFolder, ["rev-parse", "--is-shallow-repository"], options.signal)).trim() === "true";
  const candidates = sources
    .map((source) => ({ path: source.path, codeLines: countCodeLines(source.text, source.language) }))
    .filter((source) => source.codeLines >= options.minCodeLines)
    .map((source) => candidateOf(source.path, source.codeLines, breadth.get(source.path), history));
  return {
    commit,
    days: options.days,
    minCodeLines: options.minCodeLines,
    sourceFileCount: sources.length,
    commitCount: history.commitCount,
    historyIsCut,
    items: rankedItems(candidates),
  };
}

type Candidate = Omit<GodFileItem, "score">;

function candidateOf(path: string, codeLines: number, breadth: Breadth | undefined, history: History): Candidate {
  const fileHistory = history.files.get(path) ?? noHistory;
  return {
    path,
    codeLines,
    namesUsedOutside: breadth?.namesUsedOutside,
    filesUsingIt: breadth?.filesUsingIt,
    ...fileHistory,
    hint: hintOf(breadth?.namesUsedOutside.length, codeLines, fileHistory.coChangeAreas.length),
  };
}

function rankedItems(candidates: Candidate[]): GodFileItem[] {
  const ranked = rankCandidates(
    candidates,
    (candidate) => ({
      namesUsedOutside: candidate.namesUsedOutside?.length,
      coChangeAreas: candidate.coChangeAreas.length,
      commits: candidate.commits,
    }),
    (candidate) => candidate.path,
  );
  return ranked.map(({ candidate, score }) => ({ ...candidate, score }));
}

async function headCommitOf(repoFolder: string, signal?: AbortSignal): Promise<string> {
  try {
    return (await readGit(repoFolder, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], signal)).trim();
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
  const tree = await readGit(repoFolder, ["ls-tree", "-r", "-z", "--full-tree", commit], options.signal);
  const files: TrackedFile[] = [];
  for (const line of tree.split("\0")) {
    const match = /^(\d+) blob (\S+)\t(.*)$/s.exec(line);
    if (match && match[1] !== "120000" && isMeasuredSource(match[3], excludeGlobs)) {
      files.push({ path: match[3], objectId: match[2] });
    }
  }
  return files;
}

async function readSources(repoFolder: string, files: TrackedFile[], signal?: AbortSignal): Promise<SourceText[]> {
  const blobs = await readBlobs(repoFolder, files.map((file) => file.objectId), signal);
  return files.map((file, index) => ({ path: file.path, language: languageOf(file.path)!, text: blobs[index].toString("utf8") }));
}

async function isPartialClone(repoFolder: string): Promise<boolean> {
  const promisorRemotes = await readGit(repoFolder, ["config", "--get-regexp", "^remote\\..*\\.promisor$"]).catch(() => "");
  const partialClone = await readGit(repoFolder, ["config", "--get", "extensions.partialClone"]).catch(() => "");
  return promisorRemotes.includes("true") || partialClone.trim() !== "";
}
