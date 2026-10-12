import { createHash } from "crypto";
import * as path from "path";
import { runGit } from "../git/git";
import { readJsonFile, writeJsonFile } from "../state/jsonFile";

// Change markers: a codemap entry is marked when a commit changed its path after the owner last
// confirmed that the entry is still true. Only commits count, never uncommitted edits, and a mark
// only asks to look again: nothing refreshes by itself.
//
//   confirmed ──── commit ──── commit ──── HEAD        git log confirmed..HEAD -- path
//                    │                      │          → 2 commits touched the path:
//                    └─ touches path ───────┘            "Changed since you confirmed it (2 commits)"
//
// The first time an entry is seen, the current HEAD is its confirmation, so a new codemap does not
// start with every entry marked.

export interface PathStatus {
  // Set when commits changed the path since it was confirmed; undefined when nothing changed.
  change: ChangeMarker | undefined;
  // When the last commit that touched the path was made; undefined when no commit touched it.
  lastCommitTime: Date | undefined;
}

export interface ChangeMarker {
  // How many commits touched the path; undefined when the confirmed commit no longer exists
  // (the history was rewritten), so the number cannot be known.
  commits: number | undefined;
}

// The confirmed commit per path, one JSON file per repo folder, in the extension's own storage.
export class ConfirmationStore {
  constructor(private readonly folder: string) {}

  confirmedCommit(repoFolder: string, repoPath: string): string | undefined {
    return this.read(repoFolder).confirmed[repoPath];
  }

  confirm(repoFolder: string, repoPath: string, commit: string): void {
    const file = this.read(repoFolder);
    file.confirmed[repoPath] = commit;
    writeJsonFile(this.fileOf(repoFolder), file);
  }

  private read(repoFolder: string): ConfirmationFile {
    return readJsonFile<ConfirmationFile>(this.fileOf(repoFolder), { repoFolder, confirmed: {} });
  }

  // The folder's own path is in the file too, so a person can tell the files apart.
  private fileOf(repoFolder: string): string {
    const name = createHash("sha256").update(repoFolder).digest("hex").slice(0, 16);
    return path.join(this.folder, `${name}.json`);
  }
}

interface ConfirmationFile {
  repoFolder: string;
  confirmed: Record<string, string>;
}

export class ChangeMarkers {
  constructor(private readonly store: ConfirmationStore) {}

  // The status of every path, or an empty map when the folder has no commit to compare with
  // (not a git repo, or no commit yet).
  async check(repoFolder: string, repoPaths: string[]): Promise<Map<string, PathStatus>> {
    const statuses = new Map<string, PathStatus>();
    const head = await headOf(repoFolder);
    if (head === undefined) {
      return statuses;
    }
    for (const repoPath of repoPaths) {
      statuses.set(repoPath, await this.statusOf(repoFolder, repoPath, head));
    }
    return statuses;
  }

  // "Still true": the entry is confirmed at the current HEAD, which clears its mark.
  async confirm(repoFolder: string, repoPath: string): Promise<void> {
    const head = await headOf(repoFolder);
    if (head !== undefined) {
      this.store.confirm(repoFolder, repoPath, head);
    }
  }

  // An "understood" check of the owner's words confirms the entry at the commit it was checked at,
  // which may be older than HEAD by the time the check comes back.
  confirmAt(repoFolder: string, repoPath: string, commit: string): void {
    this.store.confirm(repoFolder, repoPath, commit);
  }

  private async statusOf(repoFolder: string, repoPath: string, head: string): Promise<PathStatus> {
    const lastCommitTime = await lastCommitTimeOf(repoFolder, repoPath);
    const confirmed = this.store.confirmedCommit(repoFolder, repoPath);
    if (confirmed === undefined) {
      this.store.confirm(repoFolder, repoPath, head);
      return { change: undefined, lastCommitTime };
    }
    if (!(await commitExists(repoFolder, confirmed))) {
      return { change: { commits: undefined }, lastCommitTime };
    }
    const commits = await commitsTouching(repoFolder, `${confirmed}..${head}`, repoPath);
    return { change: commits > 0 ? { commits } : undefined, lastCommitTime };
  }
}

// An explanation is older than the last change when a commit touched the path after the page was written.
export function isExplanationOlder(explanationWritten: Date, lastCommitTime: Date | undefined): boolean {
  return lastCommitTime !== undefined && lastCommitTime.getTime() > explanationWritten.getTime();
}

// "Changed since you confirmed it (2 commits)": the marker's text wherever it is shown.
export function changeText(change: ChangeMarker): string {
  if (change.commits === undefined) {
    return "Changed since you confirmed it (the confirmed commit is gone)";
  }
  return `Changed since you confirmed it (${change.commits} ${change.commits === 1 ? "commit" : "commits"})`;
}

export async function headOf(repoFolder: string): Promise<string | undefined> {
  try {
    return (await runGit(["rev-parse", "--verify", "--quiet", "HEAD"], { cwd: repoFolder })).trim();
  } catch {
    return undefined;
  }
}

export async function commitExists(repoFolder: string, commit: string): Promise<boolean> {
  try {
    await runGit(["cat-file", "-e", `${commit}^{commit}`], { cwd: repoFolder });
    return true;
  } catch {
    return false;
  }
}

// --literal-pathspecs: a path like "app/[id]/page.tsx" is a file name, not a pattern.
export async function commitsTouching(repoFolder: string, range: string, repoPath: string): Promise<number> {
  const output = await runGit(["--literal-pathspecs", "log", "--format=%H", range, "--", repoPath], { cwd: repoFolder });
  return output.split("\n").filter((line) => line.trim() !== "").length;
}

async function lastCommitTimeOf(repoFolder: string, repoPath: string): Promise<Date | undefined> {
  const output = (await runGit(["--literal-pathspecs", "log", "-1", "--format=%ct", "HEAD", "--", repoPath], { cwd: repoFolder })).trim();
  return output === "" ? undefined : new Date(Number(output) * 1000);
}
