import * as fs from "fs";
import * as path from "path";
import { PullRequest } from "../github/pullRequest";
import { runGit } from "./git";

export interface Checkout {
  pullRequest: PullRequest;
  // Commit the review is about. It can be newer than the listing's head if a push came in since.
  headSha: string;
  // The diff is taken from here, like GitHub does (base...head).
  mergeBaseSha: string;
  // Git of the extension's own clone; every git command for this PR runs here or in the worktree.
  mirrorPath: string;
  worktreePath: string;
  // Folder for everything else the extension keeps for this PR (base files, Claude's context).
  folderPath: string;
  gitEnvironment: NodeJS.ProcessEnv;
}

// Checks out pull requests into worktrees of the extension's own clone, inside the extension's
// storage. The user's working copy and its .git are never touched.
export class PullRequestCheckouts {
  constructor(
    private readonly storagePath: string,
    private readonly gitEnvironmentFor: (cloneUrl: string) => Promise<NodeJS.ProcessEnv>,
  ) {}

  async checkOut(pullRequest: PullRequest): Promise<Checkout> {
    const gitEnvironment = await this.gitEnvironmentFor(pullRequest.cloneUrl);
    const mirrorPath = await this.updateMirror(pullRequest, gitEnvironment);
    const headSha = await revParse(mirrorPath, headRef(pullRequest), gitEnvironment);
    const baseSha = await revParse(mirrorPath, baseRef(pullRequest), gitEnvironment);
    const mergeBaseSha = (await runGit(["merge-base", baseSha, headSha], { cwd: mirrorPath, env: gitEnvironment })).trim();
    const folderPath = this.pullRequestFolder(pullRequest);
    const worktreePath = path.join(folderPath, "worktree");
    await placeWorktree(mirrorPath, worktreePath, headSha, gitEnvironment);
    return { pullRequest, headSha, mergeBaseSha, mirrorPath, worktreePath, folderPath, gitEnvironment };
  }

  async remove(pullRequest: PullRequest): Promise<void> {
    const folderPath = this.pullRequestFolder(pullRequest);
    const mirrorPath = this.mirrorFolder(pullRequest);
    if (fs.existsSync(path.join(folderPath, "worktree"))) {
      await runGit(["worktree", "remove", "--force", path.join(folderPath, "worktree")], { cwd: mirrorPath });
    }
    fs.rmSync(folderPath, { recursive: true, force: true });
  }

  private async updateMirror(pullRequest: PullRequest, env: NodeJS.ProcessEnv): Promise<string> {
    const mirrorPath = this.mirrorFolder(pullRequest);
    if (!fs.existsSync(mirrorPath)) {
      fs.mkdirSync(path.dirname(mirrorPath), { recursive: true });
      // Blobs are fetched only when needed, so a large repo does not delay the first review.
      await runGit(["clone", "--bare", "--filter=blob:none", "--quiet", pullRequest.cloneUrl, mirrorPath], {
        cwd: path.dirname(mirrorPath),
        env,
      });
    }
    await runGit(
      [
        "fetch", "--quiet", "--force", "--filter=blob:none", pullRequest.cloneUrl,
        `+refs/pull/${pullRequest.number}/head:${headRef(pullRequest)}`,
        `+refs/heads/${pullRequest.baseRef}:${baseRef(pullRequest)}`,
      ],
      { cwd: mirrorPath, env },
    );
    return mirrorPath;
  }

  private mirrorFolder(pullRequest: PullRequest): string {
    return path.join(this.storagePath, "mirrors", pullRequest.repo.owner, `${pullRequest.repo.name}.git`);
  }

  private pullRequestFolder(pullRequest: PullRequest): string {
    const { owner, name } = pullRequest.repo;
    return path.join(this.storagePath, "pull-requests", owner, name, String(pullRequest.number));
  }
}

function headRef(pullRequest: PullRequest): string {
  return `refs/review-guide/pull/${pullRequest.number}/head`;
}

function baseRef(pullRequest: PullRequest): string {
  return `refs/review-guide/pull/${pullRequest.number}/base`;
}

async function revParse(mirrorPath: string, ref: string, env: NodeJS.ProcessEnv): Promise<string> {
  return (await runGit(["rev-parse", `${ref}^{commit}`], { cwd: mirrorPath, env })).trim();
}

async function placeWorktree(mirrorPath: string, worktreePath: string, headSha: string, env: NodeJS.ProcessEnv): Promise<void> {
  if (fs.existsSync(path.join(worktreePath, ".git"))) {
    await runGit(["checkout", "--quiet", "--force", "--detach", headSha], { cwd: worktreePath, env });
    return;
  }
  fs.rmSync(worktreePath, { recursive: true, force: true });
  await runGit(["worktree", "prune"], { cwd: mirrorPath, env });
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
  await runGit(["worktree", "add", "--quiet", "--force", "--detach", worktreePath, headSha], { cwd: mirrorPath, env });
}
