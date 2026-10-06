import * as vscode from "vscode";
import { badgeOf } from "../codemap/badge";
import { changeText } from "../codemap/changeMarkers";
import { repoPathOf } from "../codemap/repoPath";
import { WorkspaceChangeMarkers } from "../codemap/workspaceChangeMarkers";
import { WorkspaceCodemaps } from "../codemap/workspaceCodemaps";
import { codemapCommands } from "./codemapCommands";
import { targetOf } from "./codemapTarget";

// The codemap above the first line of a file that is in it: its badge and sentence, and "Explain";
// after a commit changed it, the change marker with "Still true" and "Explain again".
// Works for every language, because it only looks at the file's path.
export class CodemapCodeLenses implements vscode.CodeLensProvider {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;

  constructor(private readonly codemaps: WorkspaceCodemaps, private readonly markers: WorkspaceChangeMarkers) {
    codemaps.onDidChange(() => this.changed.fire());
    markers.onDidChange(() => this.changed.fire());
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
    // A CodeLens without a command is shown as plain text.
    const lenses = [
      new vscode.CodeLens(firstLine, { title: `${badgeOf(entry)} ${entry.says}`, command: "" }),
      new vscode.CodeLens(firstLine, { title: "Explain", command: codemapCommands.explain, arguments: [target] }),
    ];
    const change = this.markers.statusOf(document.uri)?.change;
    if (change) {
      lenses.push(
        new vscode.CodeLens(firstLine, { title: `$(warning) ${changeText(change)}`, command: "" }),
        new vscode.CodeLens(firstLine, { title: "Still true", command: codemapCommands.stillTrue, arguments: [target] }),
        new vscode.CodeLens(firstLine, { title: "Explain again", command: codemapCommands.explainAgain, arguments: [target] }),
      );
    }
    return lenses;
  }

  dispose(): void {
    this.changed.dispose();
  }
}
