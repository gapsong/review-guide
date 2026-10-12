import * as vscode from "vscode";
import { ChangesSinceCheck, EntryChecks } from "../analysis/entryCheck";
import { RunClaude } from "../claude/claudeCli";
import { CodemapEntry, CodemapLabel } from "./codemap";
import {
  EntryChatReply, EntryCheck, EntryRecord, nextToOwnOfAll, OwnershipState, ThreeAmCheck, threeAmCheck,
} from "./entryOwnership";
import { repoPathOf } from "./repoPath";
import { WorkspaceChangeMarkers } from "./workspaceChangeMarkers";
import { WorkspaceCodemaps } from "./workspaceCodemaps";

// Whether the owner owns each codemap entry, kept fresh: the states are worked out again whenever
// the change markers are (a commit, a checkout, a change of the codemap, the window getting the
// focus back) and after every check. Checks and chat turns run only when the owner asks.

export type EntryWork = "checking" | "answering";

export interface EntryOwnershipOptions {
  storageFolder: string;
  runClaude: RunClaude;
  language: () => string;
}

export class WorkspaceEntryOwnership implements vscode.Disposable {
  private readonly checks: EntryChecks;
  private readonly statesByFolder = new Map<string, Map<string, OwnershipState>>();
  private readonly working = new Map<string, EntryWork>();
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private readonly subscription: vscode.Disposable;
  private refreshing: Promise<void> = Promise.resolve();

  constructor(private readonly codemaps: WorkspaceCodemaps, markers: WorkspaceChangeMarkers, options: EntryOwnershipOptions) {
    this.checks = new EntryChecks({ ...options, confirmAt: (repoFolder, repoPath, commit) => markers.confirmAt(repoFolder, repoPath, commit) });
    this.subscription = markers.onDidChange(() => void this.refresh());
    void this.refresh();
  }

  // Undefined for a path that is not in the codemap.
  stateOf(uri: vscode.Uri): OwnershipState | undefined {
    const place = placeOf(uri);
    const entry = this.codemaps.entryOf(uri);
    return place && entry && this.stateIn(place.folder, entry);
  }

  recordOf(uri: vscode.Uri): EntryRecord | undefined {
    const place = placeOf(uri);
    return place && this.checks.recordOf(place.folder.uri.fsPath, place.repoPath);
  }

  // What runs for the entry right now, so the panel can say so.
  workOn(uri: vscode.Uri): EntryWork | undefined {
    return this.working.get(uri.toString());
  }

  async check(uri: vscode.Uri): Promise<EntryCheck> {
    const { folder, entry } = this.entryAt(uri);
    return this.withWork(uri, "checking", () => this.checks.check(folder.uri.fsPath, entry));
  }

  async chat(uri: vscode.Uri, message: string): Promise<EntryChatReply> {
    const { folder, entry } = this.entryAt(uri);
    return this.withWork(uri, "answering", () => this.checks.chat(folder.uri.fsPath, entry, message));
  }

  async changesSinceCheck(uri: vscode.Uri): Promise<ChangesSinceCheck | undefined> {
    const place = placeOf(uri);
    return place && this.checks.changesSinceCheck(place.folder.uri.fsPath, place.repoPath);
  }

  // Across every workspace folder with a codemap; undefined when none has an entry with these labels.
  threeAmCheck(labels: CodemapLabel[]): ThreeAmCheck | undefined {
    const entries = this.codemaps.foldersWithCodemap().flatMap((folder) => this.codemaps.entriesOf(folder).map((entry) => ({ folder, entry })));
    const folderOf = new Map(entries.map(({ folder, entry }) => [entry, folder]));
    const stateOf = (entry: CodemapEntry) => this.stateIn(folderOf.get(entry)!, entry);
    const check = threeAmCheck(entries.map(({ entry }) => entry), stateOf, labels);
    return check.total === 0 ? undefined : check;
  }

  // "Own Next": the first entry not owned yet, money first (see nextToOwnOfAll).
  nextToOwn(): { folder: vscode.WorkspaceFolder; entry: CodemapEntry } | undefined {
    for (const folder of this.codemaps.foldersWithCodemap()) {
      const entry = nextToOwnOfAll(this.codemaps.entriesOf(folder), (candidate) => this.stateIn(folder, candidate));
      if (entry) {
        return { folder, entry };
      }
    }
    return undefined;
  }

  // Resolves when the states are up to date; for tests and after a check.
  refresh(): Promise<void> {
    this.refreshing = this.refreshing.then(() => this.refreshAll()).catch(() => undefined);
    return this.refreshing;
  }

  dispose(): void {
    this.subscription.dispose();
    this.changed.dispose();
  }

  // Before the first refresh (or in a folder git cannot read) an entry counts as not checked.
  private stateIn(folder: vscode.WorkspaceFolder, entry: CodemapEntry): OwnershipState {
    return this.statesByFolder.get(folder.uri.toString())?.get(entry.path) ?? { kind: entry.mine === undefined ? "no words" : "not checked" };
  }

  private entryAt(uri: vscode.Uri): { folder: vscode.WorkspaceFolder; entry: CodemapEntry } {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const entry = this.codemaps.entryOf(uri);
    if (!folder || !entry) {
      throw new Error("Only a path in the codemap can be owned: add an entry for it to the codemap first.");
    }
    return { folder, entry };
  }

  private async withWork<T>(uri: vscode.Uri, work: EntryWork, run: () => Promise<T>): Promise<T> {
    this.working.set(uri.toString(), work);
    this.changed.fire();
    try {
      return await run();
    } finally {
      this.working.delete(uri.toString());
      await this.refresh();
    }
  }

  // A folder git cannot read shows every entry as not checked rather than an error after each commit.
  private async refreshAll(): Promise<void> {
    const statesByFolder = new Map<string, Map<string, OwnershipState>>();
    for (const folder of this.codemaps.foldersWithCodemap()) {
      const states = await this.checks.statesOf(folder.uri.fsPath, this.codemaps.entriesOf(folder)).catch(() => new Map<string, OwnershipState>());
      statesByFolder.set(folder.uri.toString(), states);
    }
    this.statesByFolder.clear();
    for (const [folder, states] of statesByFolder) {
      this.statesByFolder.set(folder, states);
    }
    this.changed.fire();
  }
}

function placeOf(uri: vscode.Uri): { folder: vscode.WorkspaceFolder; repoPath: string } | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  const repoPath = folder && repoPathOf(folder.uri.fsPath, uri.fsPath);
  return folder && repoPath !== undefined ? { folder, repoPath } : undefined;
}
