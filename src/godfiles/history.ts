import { areaOf, godFileRules } from "./rules";
import { readGit } from "./readOnlyGit";

// Reasons to change, from ONE git log pass over the window before HEAD:
//
//   commit ─┬─ checkout.py ┐
//           ├─ payment.py  ├─ changed together: each is the other's co-change partner
//           └─ README.md   ┘  (partners are measured source files only)
//
// A commit with more than godFileRules.largestCoChangeCommitFiles files is a sweep: it still counts
// as a commit of each file, but its files are nobody's partners.
//
// The window ends at HEAD's commit time, not at the clock: the numbers belong to the commit, so a
// result cached for a commit stays true, and a test repo gives the same numbers every day.

export interface FileHistory {
  commitsInWindow: number;
  commitsInRecentDays: number;
  // Other measured source files changed in the same commits, sorted.
  coChangePartners: string[];
  // The areas of those partners (rules.ts, areaOf), sorted.
  coChangeAreas: string[];
}

export interface History {
  // Commits in the window (merges left out), whether or not they touched a measured file.
  commitCount: number;
  files: Map<string, FileHistory>;
}

export interface Commit {
  committedAtSeconds: number;
  // Paths as they are at HEAD: a file renamed later in history counts under its new path.
  paths: string[];
}

const daySeconds = 24 * 60 * 60;

export async function readHistory(repoFolder: string, headCommit: string, days: number, measuredPaths: Set<string>, isPartialClone: boolean, signal?: AbortSignal): Promise<History> {
  const headTimeSeconds = Number((await readGit(repoFolder, ["show", "-s", "--format=%ct", headCommit], signal)).trim());
  const windowStartSeconds = headTimeSeconds - days * daySeconds;
  // Finding a rename that changed the file too needs the file's old content; a partial clone may
  // not have it and must not fetch it, so there only exact renames count.
  const renames = isPartialClone ? "-M100%" : "-M";
  const log = await readGit(repoFolder, ["log", "--no-merges", "-z", "--name-status", renames, "--format=%x1e%H %ct", `--since=@${windowStartSeconds}`, headCommit], signal);
  const commits = parseLog(log).filter((commit) => commit.committedAtSeconds >= windowStartSeconds);
  return historyOf(commits, measuredPaths, headTimeSeconds - godFileRules.recentDays * daySeconds);
}

// The log, newest first. A rename ("R100 old new") maps the old path to the new one for every
// older commit, so a file keeps its history across a move.
export function parseLog(log: string): Commit[] {
  const currentPathOf = new Map<string, string>();
  const commits: Commit[] = [];
  for (const record of log.split("\x1e").slice(1)) {
    const headerEnd = record.indexOf("\0");
    const header = headerEnd === -1 ? record : record.slice(0, headerEnd);
    const committedAtSeconds = Number(header.trim().split(" ")[1]);
    const fields = headerEnd === -1 ? [] : record.slice(headerEnd + 1).replace(/^\n/, "").split("\0").filter((field) => field !== "");
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
        const filePath = fields[i + 1];
        paths.add(currentPathOf.get(filePath) ?? filePath);
        i += 2;
      }
    }
    commits.push({ committedAtSeconds, paths: [...paths] });
  }
  return commits;
}

export function historyOf(commits: Commit[], measuredPaths: Set<string>, recentStartSeconds: number): History {
  const counts = new Map<string, { all: number; recent: number; partners: Set<string> }>();
  for (const commit of commits) {
    const measured = commit.paths.filter((filePath) => measuredPaths.has(filePath));
    const isSweep = commit.paths.length > godFileRules.largestCoChangeCommitFiles;
    for (const filePath of measured) {
      const count = counts.get(filePath) ?? { all: 0, recent: 0, partners: new Set<string>() };
      count.all++;
      if (commit.committedAtSeconds >= recentStartSeconds) {
        count.recent++;
      }
      if (!isSweep) {
        for (const partner of measured) {
          if (partner !== filePath) {
            count.partners.add(partner);
          }
        }
      }
      counts.set(filePath, count);
    }
  }
  const files = new Map<string, FileHistory>();
  for (const [filePath, count] of counts) {
    const partners = [...count.partners].sort();
    files.set(filePath, {
      commitsInWindow: count.all,
      commitsInRecentDays: count.recent,
      coChangePartners: partners,
      coChangeAreas: [...new Set(partners.map(areaOf))].sort(),
    });
  }
  return { commitCount: commits.length, files };
}

export const noHistory: FileHistory = { commitsInWindow: 0, commitsInRecentDays: 0, coChangePartners: [], coChangeAreas: [] };
