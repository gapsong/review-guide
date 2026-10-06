import * as vscode from "vscode";
import { badgeOf } from "../codemap/badge";
import { WorkspaceCodemaps } from "../codemap/workspaceCodemaps";
import { repoPathOf } from "../codemap/repoPath";
import { targetOf } from "./codemapTarget";
import { codemapCommands } from "./codemapView";

// The codemap above the first line of a file that is in it: its badge and sentence, and "Explain".
// Works for every language, because it only looks at the file's path.
export class CodemapCodeLenses implements vscode.CodeLensProvider {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;

  constructor(private readonly codemaps: WorkspaceCodemaps) {
    codemaps.onDidChange(() => this.changed.fire());
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const entry = this.codemaps.entryOf(document.uri);
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    const repoPath = folder && repoPathOf(folder.uri.fsPath, document.uri.fsPath);
    if (!entry || !folder || repoPath === undefined) {
      return [];
    }
    const target = targetOf(folder, repoPath);
    const firstLine = new vscode.Range(0, 0, 0, 0);
    return [
      // A CodeLens without a command is shown as plain text.
      new vscode.CodeLens(firstLine, { title: `${badgeOf(entry)} ${entry.says}`, command: "" }),
      new vscode.CodeLens(firstLine, { title: "Explain", command: codemapCommands.explain, arguments: [target] }),
    ];
  }

  dispose(): void {
    this.changed.dispose();
  }
}
