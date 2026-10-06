import * as fs from "fs";
import * as vscode from "vscode";
import { isExplanationOlder } from "../codemap/changeMarkers";
import { explanationPageOf } from "../codemap/explanationFiles";
import { WorkspaceChangeMarkers } from "../codemap/workspaceChangeMarkers";
import { CodemapTarget, uriOfTarget } from "./codemapTarget";
import { EntryStatus } from "./codemapTooltip";

// What the view, the CodeLens and the Explain panel say about an entry beyond the codemap itself:
// its explanation on disk and its change marker.
export function entryStatusOf(target: CodemapTarget, markers: WorkspaceChangeMarkers): EntryStatus {
  const pathStatus = markers.statusOf(uriOfTarget(target));
  const page = vscode.Uri.joinPath(vscode.Uri.parse(target.folderUri), explanationPageOf(target.path)).fsPath;
  const explanationWritten = fs.existsSync(page) ? fs.statSync(page).mtime : undefined;
  return {
    explanationWritten,
    explanationOlder: explanationWritten !== undefined && isExplanationOlder(explanationWritten, pathStatus?.lastCommitTime),
    change: pathStatus?.change,
  };
}
