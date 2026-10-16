import * as path from "path";
import * as vscode from "vscode";
import { runGit } from "../git/git";
import { ChangeMarkers, ConfirmationStore, PathStatus } from "./changeMarkers";
import { repoPathOf } from "./repoPath";
import { WorkspaceCodemaps } from "./workspaceCodemaps";

// The change markers of every codemap in the workspace, kept fresh: checked again when the codemap
// changes, when HEAD moves (a commit, a checkout, a pull) and when the window gets the focus back
// (a commit made in another program).
export class WorkspaceChangeMarkers implements vscode.Disposable {
  private readonly markers: ChangeMarkers;
  private readonly statusesByFolder = new Map<string, Map<string, PathStatus>>();
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private gitWatchers: vscode.Disposable[] = [];
  private readonly subscriptions: vscode.Disposable[];
  // One check at a time; a request during a check runs one more check after it.
  private running: Promise<void> | undefined;
  private checkRequested = false;
  private debounce: NodeJS.Timeout | undefined;

  constructor(private readonly codemaps: WorkspaceCodemaps, storageFolder: string) {
    this.markers = new ChangeMarkers(new ConfirmationStore(storageFolder));
    this.subscriptions = [
      codemaps.onDidChange(() => {
        void this.watchGit();
        this.requestCheck();
      }),
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          this.requestCheck();
        }
      }),
    ];
    void this.watchGit();
    this.requestCheck();
  }

  statusOf(uri: vscode.Uri): PathStatus | undefined {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const repoPath = folder && repoPathOf(folder.uri.fsPath, uri.fsPath);
    if (!folder || repoPath === undefined) {
      return undefined;
    }
    return this.statusesByFolder.get(folder.uri.toString())?.get(repoPath);
  }

  // "Still true" for one entry: confirmed at the current HEAD, and its mark is gone at once.
  async confirm(uri: vscode.Uri): Promise<void> {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const repoPath = folder && repoPathOf(folder.uri.fsPath, uri.fsPath);
    if (!folder || repoPath === undefined) {
      return;
    }
    await this.markers.confirm(folder.uri.fsPath, repoPath);
    await this.check();
  }

  // An "understood" check of the owner's words confirms the entry at the commit it read.
  async confirmAt(repoFolder: string, repoPath: string, commit: string): Promise<void> {
    this.markers.confirmAt(repoFolder, repoPath, commit);
    await this.check();
  }

  // Resolves when the markers are up to date; for tests and for "Still true".
  async check(): Promise<void> {
    this.checkRequested = true;
    this.running ??= this.checkWhileRequested().finally(() => {
      this.running = undefined;
    });
    await this.running;
  }

  dispose(): void {
    clearTimeout(this.debounce);
    disposeAll(this.gitWatchers);
    disposeAll(this.subscriptions);
    this.changed.dispose();
  }

  // Git writes several files for one commit; one check after the last of them is enough.
  private requestCheck(): void {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.check(), 300);
  }

  private async checkWhileRequested(): Promise<void> {
    while (this.checkRequested) {
      this.checkRequested = false;
      await this.checkAll();
    }
  }

  private async checkAll(): Promise<void> {
    const statusesByFolder = new Map<string, Map<string, PathStatus>>();
    for (const folder of this.codemaps.foldersWithCodemap()) {
      const paths = this.codemaps.entriesOf(folder).map((entry) => entry.path);
      statusesByFolder.set(folder.uri.toString(), await this.checkFolder(folder, paths));
    }
    this.statusesByFolder.clear();
    for (const [folder, statuses] of statusesByFolder) {
      this.statusesByFolder.set(folder, statuses);
    }
    this.changed.fire();
  }

  // A folder git cannot read (a broken repo, git missing) shows no markers rather than an error
  // after every commit and every focus change; the codemap itself still works.
  private async checkFolder(folder: vscode.WorkspaceFolder, paths: string[]): Promise<Map<string, PathStatus>> {
    try {
      return await this.markers.check(folder.uri.fsPath, paths);
    } catch {
      return new Map();
    }
  }

  private async watchGit(): Promise<void> {
    const watchers: vscode.Disposable[] = [];
    for (const folder of this.codemaps.foldersWithCodemap()) {
      watchers.push(...(await watchHead(folder.uri.fsPath, () => this.requestCheck())) ?? []);
    }
    disposeAll(this.gitWatchers);
    this.gitWatchers = watchers;
  }
}

// HEAD moves with every commit, checkout and pull, and git appends to logs/HEAD each time.
// A worktree keeps HEAD in its own git folder and the branches in the common one. Undefined when
// the folder is not in a git repo.
export async function watchHead(folder: string, headMoved: () => void): Promise<vscode.Disposable[] | undefined> {
  let gitFolders: string[];
  try {
    const output = await runGit(["rev-parse", "--absolute-git-dir", "--git-common-dir"], { cwd: folder });
    gitFolders = output.trim().split("\n").map((gitFolder) => path.resolve(folder, gitFolder));
  } catch {
    return undefined;
  }
  const ownFiles = new vscode.RelativePattern(vscode.Uri.file(gitFolders[0]), "{HEAD,logs/HEAD}");
  const sharedFiles = new vscode.RelativePattern(vscode.Uri.file(gitFolders[1]), "{packed-refs,refs/heads/**}");
  return [ownFiles, sharedFiles].map((pattern) => {
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    watcher.onDidCreate(headMoved);
    watcher.onDidChange(headMoved);
    watcher.onDidDelete(headMoved);
    return watcher;
  });
}

function disposeAll(disposables: vscode.Disposable[]): void {
  for (const disposable of disposables) {
    disposable.dispose();
  }
}
