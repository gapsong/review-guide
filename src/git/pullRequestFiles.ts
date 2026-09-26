import * as fs from "fs";
import * as path from "path";
import { FileDiff, parseUnifiedDiff } from "../review/unifiedDiff";
import { runGit } from "./git";
import { Checkout } from "./pullRequestCheckout";

export async function readChangedFiles(checkout: Checkout): Promise<FileDiff[]> {
  const diff = await runGit(
    ["-c", "core.quotePath=false", "diff", "--no-color", "--no-ext-diff", "--find-renames", "-U3", checkout.mergeBaseSha, checkout.headSha],
    { cwd: checkout.mirrorPath, env: checkout.gitEnvironment },
  );
  return parseUnifiedDiff(diff).filter((file) => !file.isBinary);
}

// The two sides of a file's diff, as files on disk: the base version is written out, the head
// version is the worktree file. A side where the file does not exist is an empty file.
export interface FileSides {
  basePath: string;
  headPath: string;
}

export function fileSides(checkout: Checkout, file: FileDiff): FileSides {
  return {
    basePath: path.join(checkout.folderPath, "base", file.oldPath),
    headPath: file.status === "deleted"
      ? path.join(checkout.folderPath, "deleted", file.oldPath)
      : path.join(checkout.worktreePath, file.newPath),
  };
}

export async function writeFileSides(checkout: Checkout, files: FileDiff[]): Promise<void> {
  for (const file of files) {
    const sides = fileSides(checkout, file);
    const baseContent = file.status === "added" ? "" : await readBaseVersion(checkout, file.oldPath);
    writeFile(sides.basePath, baseContent);
    if (file.status === "deleted") {
      writeFile(sides.headPath, "");
    }
  }
}

async function readBaseVersion(checkout: Checkout, filePath: string): Promise<string> {
  return runGit(["cat-file", "blob", `${checkout.mergeBaseSha}:${filePath}`], {
    cwd: checkout.mirrorPath,
    env: checkout.gitEnvironment,
  });
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}
