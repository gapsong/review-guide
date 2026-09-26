import { execFileSync } from "child_process";
import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { PullRequest } from "../../src/github/pullRequest";
import type { FakePull } from "./fakeGitHub";

export type FileTree = Record<string, string>;

// The real path: on macOS the temp folder is under /var, a link to /private/var, and processes
// started in it (git, the fake claude) report the /private/var form.
export function makeTempDir(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `review-guide-${prefix}-`)));
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" },
  }).trim();
}

export interface FixtureRemote {
  remotePath: string;
  baseSha: string;
  headSha: string;
  pull: FakePull;
}

// A repo that plays GitHub's side: branch "main" holds the base files, and the PR's head commit
// is published under refs/pull/<number>/head, like GitHub does.
export function createFixtureRemote(parent: string, base: FileTree, head: FileTree, number = 1): FixtureRemote {
  const remotePath = path.join(parent, "remote");
  fs.mkdirSync(remotePath, { recursive: true });
  git(remotePath, "init", "--quiet", "--initial-branch=main");
  const baseSha = commitFiles(remotePath, base, "Base");
  git(remotePath, "checkout", "--quiet", "-b", "feature");
  const headSha = commitFiles(remotePath, head, "Head of the PR");
  git(remotePath, "update-ref", `refs/pull/${number}/head`, headSha);
  git(remotePath, "checkout", "--quiet", "main");
  return {
    remotePath,
    baseSha,
    headSha,
    pull: { number, title: "Fixture PR", cloneUrl: remotePath, baseRef: "main", baseSha, headRef: "feature", headSha },
  };
}

// Pushes a new head for the PR, as if the author pushed again.
export function pushNewHead(remote: FixtureRemote, files: FileTree): string {
  git(remote.remotePath, "checkout", "--quiet", "feature");
  const headSha = commitFiles(remote.remotePath, files, "Another push");
  git(remote.remotePath, "update-ref", `refs/pull/${remote.pull.number}/head`, headSha);
  git(remote.remotePath, "checkout", "--quiet", "main");
  remote.headSha = headSha;
  remote.pull.headSha = headSha;
  return headSha;
}

// Publishes a second PR against the same base, from its own branch.
export function addPullRequest(remote: FixtureRemote, files: FileTree, number: number): FakePull {
  git(remote.remotePath, "checkout", "--quiet", "-b", `feature-${number}`, remote.baseSha);
  const headSha = commitFiles(remote.remotePath, files, `Head of PR ${number}`);
  git(remote.remotePath, "update-ref", `refs/pull/${number}/head`, headSha);
  git(remote.remotePath, "checkout", "--quiet", "main");
  return { number, title: `Fixture PR ${number}`, cloneUrl: remote.remotePath, baseRef: "main", baseSha: remote.baseSha, headRef: `feature-${number}`, headSha };
}

// Replaces the whole tree with `files` and commits it.
function commitFiles(repoPath: string, files: FileTree, message: string): string {
  for (const entry of fs.readdirSync(repoPath)) {
    if (entry !== ".git") {
      fs.rmSync(path.join(repoPath, entry), { recursive: true, force: true });
    }
  }
  for (const [filePath, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repoPath, filePath)), { recursive: true });
    fs.writeFileSync(path.join(repoPath, filePath), content);
  }
  git(repoPath, "add", "--all");
  git(repoPath, "commit", "--quiet", "--allow-empty", "-m", message);
  return git(repoPath, "rev-parse", "HEAD");
}

// A fingerprint of every file below `folder`, .git included: any byte that changes, changes it.
export function fingerprint(folder: string): string {
  const hash = createHash("sha256");
  for (const filePath of listFiles(folder).sort()) {
    hash.update(filePath).update("\0").update(fs.readFileSync(path.join(folder, filePath))).update("\0");
  }
  return hash.digest("hex");
}

function listFiles(folder: string, prefix = ""): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(path.join(folder, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(folder, relative));
    } else {
      files.push(relative);
    }
  }
  return files;
}

export function pullRequestOf(pull: FakePull, repo = { owner: "reviewer", name: "fixture" }): PullRequest {
  return { ...pull, repo, body: pull.body ?? "", author: "reviewer", url: "" };
}
