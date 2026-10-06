import * as vscode from "vscode";

// A codemap path in one workspace folder, as plain text: command links in a tooltip and the
// arguments of a CodeLens are JSON, and a vscode.Uri does not survive that trip.
export interface CodemapTarget {
  folderUri: string;
  path: string;
}

export function targetOf(folder: vscode.WorkspaceFolder, path: string): CodemapTarget {
  return { folderUri: folder.uri.toString(), path };
}

export function uriOfTarget(target: CodemapTarget): vscode.Uri {
  return vscode.Uri.joinPath(vscode.Uri.parse(target.folderUri), ...target.path.split("/"));
}

export function folderOfTarget(target: CodemapTarget): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.workspaceFolders?.find((folder) => folder.uri.toString() === target.folderUri);
}

// A link for a trusted MarkdownString that runs a command with the target as its one argument.
export function commandLink(command: string, target: CodemapTarget): string {
  return `command:${command}?${encodeURIComponent(JSON.stringify([target]))}`;
}
