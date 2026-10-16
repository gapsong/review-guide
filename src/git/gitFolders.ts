import * as path from "path";
import { runGit } from "./git";

// Where git keeps a working copy's HEAD, and its branches. A worktree keeps HEAD in its own git
// folder and the branches in the common one; undefined when the folder is not in a git repo.
export async function gitFoldersOf(folder: string): Promise<{ gitFolder: string; commonFolder: string } | undefined> {
  try {
    const output = await runGit(["rev-parse", "--absolute-git-dir", "--git-common-dir"], { cwd: folder });
    const [gitFolder, commonFolder] = output.trim().split("\n");
    return { gitFolder, commonFolder: path.resolve(folder, commonFolder) };
  } catch {
    return undefined;
  }
}
