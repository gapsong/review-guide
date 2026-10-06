import * as vscode from "vscode";
import { badgeOf, tooltipOf } from "../codemap/badge";
import { WorkspaceCodemaps } from "../codemap/workspaceCodemaps";

// The codemap in the Explorer: every listed file or folder gets its badge, and its sentence on hover.
export class CodemapDecorations implements vscode.FileDecorationProvider {
  private readonly changed = new vscode.EventEmitter<undefined>();
  readonly onDidChangeFileDecorations = this.changed.event;

  constructor(private readonly codemaps: WorkspaceCodemaps) {
    // undefined asks VS Code to redraw every decoration, which also clears paths that left the codemap.
    codemaps.onDidChange(() => this.changed.fire(undefined));
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const entry = this.codemaps.entryOf(uri);
    if (!entry) {
      return undefined;
    }
    const decoration = new vscode.FileDecoration(badgeOf(entry), tooltipOf(entry));
    // A folder's label says what the folder is about, not what each file inside it is.
    decoration.propagate = false;
    return decoration;
  }
}
