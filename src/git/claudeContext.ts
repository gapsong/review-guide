import * as fs from "fs";
import * as path from "path";
import { FileDiff } from "../review/unifiedDiff";
import { runGit } from "./git";
import { Checkout } from "./pullRequestCheckout";

// Claude gets no shell, so the extension runs the git commands itself and leaves the output
// in a folder that Claude may read.
export async function writeClaudeContext(checkout: Checkout, files: FileDiff[]): Promise<string> {
  const folder = path.join(checkout.folderPath, "context");
  fs.mkdirSync(folder, { recursive: true });
  const { pullRequest } = checkout;
  const commitMessages = await readCommitMessages(checkout);
  fs.writeFileSync(
    path.join(folder, "pull-request.md"),
    `# PR #${pullRequest.number}: ${pullRequest.title}\n\n${pullRequest.body}\n\n## Commits\n\n${commitMessages}`,
  );
  fs.writeFileSync(path.join(folder, "changes.diff"), await git(checkout, ["diff", "--no-color", "--find-renames", checkout.mergeBaseSha, checkout.headSha]));
  fs.writeFileSync(path.join(folder, "history.txt"), await historyOfChangedFiles(checkout, files));
  return folder;
}

export async function readCommitMessages(checkout: Checkout): Promise<string> {
  return git(checkout, ["log", "--reverse", "--format=- %s%n%w(0,2,2)%b", `${checkout.mergeBaseSha}..${checkout.headSha}`]);
}

// The repo profile as it is on the base branch: a PR cannot change the rules its own review uses.
export async function readRepoProfile(checkout: Checkout): Promise<string | undefined> {
  try {
    return await git(checkout, ["cat-file", "blob", `${checkout.mergeBaseSha}:.review-guide.md`]);
  } catch {
    return undefined;
  }
}

async function historyOfChangedFiles(checkout: Checkout, files: FileDiff[]): Promise<string> {
  const sections: string[] = [];
  for (const file of files) {
    const log = await git(checkout, ["log", "-n", "10", "--format=%h %ad %an: %s", "--date=short", checkout.headSha, "--", file.newPath]);
    sections.push(`## ${file.newPath}\n${log}`);
  }
  return sections.join("\n");
}

function git(checkout: Checkout, args: string[]): Promise<string> {
  return runGit(args, { cwd: checkout.mirrorPath, env: checkout.gitEnvironment });
}
