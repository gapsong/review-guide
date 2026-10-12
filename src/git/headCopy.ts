import { spawn } from "child_process";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { runGit } from "./git";

// A clean copy of a workspace folder's HEAD, for Claude to read. Only tracked files at the last
// commit are in it, so an ignored .env, an untracked file or a half-done edit never reaches Claude,
// and a verdict belongs to exactly one commit.
//
//   repo/.git ── git archive HEAD ──► storage/<folder hash>/<sha>/   (tracked files only)
//
// The copy never holds the personal .codemap folder, even when it is committed: the check of the
// owner's words must not see the explanation page (DECISIONS.md, D1).

export interface HeadCopy {
  // The commit the copy was made from.
  commit: string;
  // The copy itself; Claude's working directory.
  folder: string;
}

// The folders that are left out of every copy, as repo paths.
export const foldersLeftOut = [".codemap"];

// A copy is reused while HEAD stays; the copies of the two newest commits are kept, so a check
// that is still running on the previous HEAD keeps its files.
const copiesKept = 2;

export class HeadCopies {
  constructor(private readonly storageFolder: string) {}

  async copyOf(repoFolder: string): Promise<HeadCopy> {
    await refusePartialClone(repoFolder);
    const commit = await headCommitOf(repoFolder);
    const copiesFolder = path.join(this.storageFolder, folderKey(repoFolder));
    const folder = path.join(copiesFolder, commit);
    if (!fs.existsSync(folder)) {
      await writeCopy(repoFolder, commit, folder);
    }
    markUsed(folder);
    removeOlderCopies(copiesFolder);
    return { commit, folder };
  }
}

// The same hash names a folder's files everywhere in the extension's storage (see changeMarkers.ts).
export function folderKey(repoFolder: string): string {
  return createHash("sha256").update(repoFolder).digest("hex").slice(0, 16);
}

// In a partial clone, git archive fetches the blobs it lacks, which writes into the repo's .git.
async function refusePartialClone(repoFolder: string): Promise<void> {
  const promisorRemotes = await runGit(["config", "--get-regexp", "^remote\\..*\\.promisor$"], { cwd: repoFolder }).catch(() => "");
  const partialClone = await runGit(["config", "--get", "extensions.partialClone"], { cwd: repoFolder }).catch(() => "");
  if (promisorRemotes.includes("true") || partialClone.trim() !== "") {
    throw new Error("This repo is a partial clone: copying its HEAD would fetch missing files into its .git, so Review Guide does not copy it.");
  }
}

async function headCommitOf(repoFolder: string): Promise<string> {
  try {
    return (await runGit(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], { cwd: repoFolder })).trim();
  } catch {
    throw new Error("The workspace folder has no commit yet, so there is nothing to check against.");
  }
}

// Written into a folder of its own first and renamed when complete, so a crash never leaves a half copy
// that later looks finished.
async function writeCopy(repoFolder: string, commit: string, folder: string): Promise<void> {
  const unfinished = `${folder}.${process.pid}.partial`;
  fs.rmSync(unfinished, { recursive: true, force: true });
  fs.mkdirSync(unfinished, { recursive: true });
  try {
    await extractArchive(repoFolder, commit, unfinished);
    removeLinksLeavingFolder(unfinished);
    fs.renameSync(unfinished, folder);
  } catch (error) {
    fs.rmSync(unfinished, { recursive: true, force: true });
    throw error;
  }
}

// git archive | tar -x, without a shell in between: no path can become a command.
function extractArchive(repoFolder: string, commit: string, target: string): Promise<void> {
  const leftOut = foldersLeftOut.map((folder) => `:(exclude)${folder}`);
  const archive = spawn("git", ["archive", "--format=tar", commit, "--", ".", ...leftOut], { cwd: repoFolder, stdio: ["ignore", "pipe", "pipe"] });
  const tar = spawn("tar", ["-x", "-f", "-", "-C", target], { stdio: ["pipe", "ignore", "pipe"] });
  archive.stdout.pipe(tar.stdin);
  return Promise.all([finished(archive, "git archive"), finished(tar, "tar")]).then(() => undefined);
}

function finished(child: ReturnType<typeof spawn>, name: string): Promise<void> {
  const errors: Buffer[] = [];
  child.stderr?.on("data", (chunk: Buffer) => errors.push(chunk));
  return new Promise((resolve, reject) => {
    child.on("error", (error) => reject(new Error(`${name} could not start: ${error.message}`)));
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${name} failed with exit code ${code}: ${Buffer.concat(errors).toString("utf8").trim()}`));
      }
    });
  });
}

// A committed symbolic link may point anywhere, "/etc" or "../../.env"; Claude may read only the copy.
// Links that point outside it, or nowhere, are removed, until none is left: removing one link
// can turn another link through it into one that points nowhere.
function removeLinksLeavingFolder(folder: string): void {
  const root = fs.realpathSync(folder);
  let removedOne = true;
  while (removedOne) {
    removedOne = false;
    for (const link of symbolicLinksIn(root)) {
      if (!pointsInside(link, root)) {
        fs.unlinkSync(link);
        removedOne = true;
      }
    }
  }
}

function pointsInside(link: string, root: string): boolean {
  try {
    const target = fs.realpathSync(link);
    return target === root || target.startsWith(root + path.sep);
  } catch {
    return false;
  }
}

function symbolicLinksIn(folder: string): string[] {
  const links: string[] = [];
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const entryPath = path.join(folder, entry.name);
    if (entry.isSymbolicLink()) {
      links.push(entryPath);
    } else if (entry.isDirectory()) {
      links.push(...symbolicLinksIn(entryPath));
    }
  }
  return links;
}

function markUsed(folder: string): void {
  const now = new Date();
  fs.utimesSync(folder, now, now);
}

function removeOlderCopies(copiesFolder: string): void {
  const copies = fs.readdirSync(copiesFolder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.endsWith(".partial"))
    .map((entry) => path.join(copiesFolder, entry.name))
    .sort((first, second) => fs.statSync(second).mtimeMs - fs.statSync(first).mtimeMs);
  for (const old of copies.slice(copiesKept)) {
    fs.rmSync(old, { recursive: true, force: true });
  }
}
