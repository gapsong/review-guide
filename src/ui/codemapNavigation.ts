import * as fs from "fs";
import * as vscode from "vscode";
import { CodemapEntry, startLocationOf } from "../codemap/codemap";
import { CodemapTarget, uriOfTarget } from "./codemapTarget";

// Opens a file in the editor, or shows a folder in the Explorer.
export async function openCodemapPath(target: CodemapTarget): Promise<void> {
  const uri = uriOfTarget(target);
  if (isDirectory(uri.fsPath)) {
    await vscode.commands.executeCommand("revealInExplorer", uri);
    return;
  }
  await vscode.commands.executeCommand("vscode.open", uri);
}

// Opens the file that the entry's "start" points to, at its line.
export async function openStartOf(target: CodemapTarget, entry: CodemapEntry): Promise<void> {
  const start = entry.start === undefined ? undefined : startLocationOf(entry.start);
  if (!start) {
    return;
  }
  const startTarget = { folderUri: target.folderUri, path: start.path };
  if (start.line === undefined) {
    await openCodemapPath(startTarget);
    return;
  }
  const line = new vscode.Position(start.line - 1, 0);
  await vscode.window.showTextDocument(uriOfTarget(startTarget), { selection: new vscode.Range(line, line) });
}

export function isDirectory(filePath: string): boolean {
  return fs.existsSync(filePath) && fs.statSync(filePath).isDirectory();
}
