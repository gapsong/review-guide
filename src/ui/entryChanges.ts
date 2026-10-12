import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { cleanRelativePath } from "../codemap/repoPath";
import { WorkspaceEntryOwnership } from "../codemap/workspaceEntryOwnership";
import { runGit } from "../git/git";
import { folderKey } from "../git/headCopy";
import { CodemapTarget, folderOfTarget, uriOfTarget } from "./codemapTarget";
import { isDirectory } from "./codemapNavigation";
import { shortCommit } from "./ownershipText";

// "Show changes": what changed in an entry's path between the owner's check and HEAD. Only commits
// count, so both sides come from git, never from the working copy:
//   a file   → a diff of the file at the checked commit against the file at HEAD;
//   a folder → its commits and changed files to pick from, each opening such a diff.
// The two sides are written into the extension's storage (entry-sides/), never into the repo.
export async function showEntryChanges(target: CodemapTarget, ownership: WorkspaceEntryOwnership, storageFolder: string): Promise<void> {
  const folder = folderOfTarget(target);
  const changes = await ownership.changesSinceCheck(uriOfTarget(target));
  if (!folder || !changes) {
    void vscode.window.showInformationMessage("Review Guide: check your words first; changes are counted from your check.");
    return;
  }
  if (changes.commitIsGone) {
    void vscode.window.showInformationMessage(`Review Guide: the checked commit ${shortCommit(changes.checkedCommit)} is gone (the history was rewritten), so its changes cannot be shown.`);
    return;
  }
  if (changes.files.length === 0) {
    void vscode.window.showInformationMessage(`Review Guide: no commit changed ${target.path} since your check.`);
    return;
  }
  const head = (await runGit(["rev-parse", "HEAD"], { cwd: folder.uri.fsPath })).trim();
  const sides = { repoFolder: folder.uri.fsPath, storageFolder, checked: changes.checkedCommit, head };
  if (!isDirectory(uriOfTarget(target).fsPath)) {
    await openDiff(sides, target.path);
    return;
  }
  const picked = await vscode.window.showQuickPick(
    changes.files.map((file) => ({ label: file, description: "" })),
    { title: `${target.path}: ${changes.commits.length} commits since your check`, placeHolder: changes.commits.join(" · ") },
  );
  if (picked) {
    await openDiff(sides, picked.label);
  }
}

interface Sides {
  repoFolder: string;
  storageFolder: string;
  checked: string;
  head: string;
}

async function openDiff(sides: Sides, repoPath: string): Promise<void> {
  const before = await sideOf(sides, sides.checked, repoPath);
  const after = await sideOf(sides, sides.head, repoPath);
  const title = `${path.posix.basename(repoPath)}: your check (${shortCommit(sides.checked)}) ↔ HEAD (${shortCommit(sides.head)})`;
  await vscode.commands.executeCommand("vscode.diff", vscode.Uri.file(before), vscode.Uri.file(after), title);
}

// A file that did not exist at that commit (added or deleted since) is an empty side.
async function sideOf(sides: Sides, commit: string, repoPath: string): Promise<string> {
  const cleanPath = cleanRelativePath(repoPath);
  if (cleanPath === undefined) {
    throw new Error(`Not a path inside the repo: ${repoPath}`);
  }
  const file = path.join(sides.storageFolder, "entry-sides", folderKey(sides.repoFolder), commit, ...cleanPath.split("/"));
  if (!fs.existsSync(file)) {
    const text = await runGit(["show", `${commit}:./${cleanPath}`], { cwd: sides.repoFolder }).catch(() => "");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  return file;
}
