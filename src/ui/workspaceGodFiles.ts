import * as vscode from "vscode";
import { gitFoldersOf } from "../git/gitFolders";
import { GodFileOptions, GodFileReport, measureGodFiles } from "../godfiles/godFiles";
import { MeasurementCancelled, readGit } from "../godfiles/readOnlyGit";
import { GodFileReportCache } from "../godfiles/reportCache";
import { godFileDefaults } from "../godfiles/rules";

// The god files of every workspace folder that is a git repo, kept fresh: measured the first time
// the view is shown, again when HEAD moves (a commit, a checkout, a pull) or a setting changes,
// and on Refresh. Reports are cached per repo and HEAD commit in the extension's storage.

export type FolderGodFiles =
  | { folder: vscode.WorkspaceFolder; state: "measuring" }
  | { folder: vscode.WorkspaceFolder; state: "ready"; report: GodFileReport }
  | { folder: vscode.WorkspaceFolder; state: "failed"; message: string };

export interface GodFileSettings extends Omit<GodFileOptions, "signal"> {
  maxItems: number;
}

export function godFileSettings(): GodFileSettings {
  const settings = vscode.workspace.getConfiguration("reviewGuide.godFiles");
  return {
    days: settings.get<number>("days", godFileDefaults.days),
    minCodeLines: settings.get<number>("minLines", godFileDefaults.minCodeLines),
    maxItems: settings.get<number>("maxItems", godFileDefaults.maxItems),
    exclude: settings.get<string[]>("exclude", []),
  };
}

export class WorkspaceGodFiles implements vscode.Disposable {
  private readonly cache: GodFileReportCache;
  private readonly states = new Map<string, FolderGodFiles>();
  private repoFolders: vscode.WorkspaceFolder[] = [];
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private gitWatchers: vscode.Disposable[] = [];
  private readonly subscriptions: vscode.Disposable[];
  private started = false;
  private debounce: NodeJS.Timeout | undefined;
  // One measurement at a time; a request during one runs one more after it.
  private running: Promise<void> | undefined;
  private measureRequested: { ignoreCache: boolean } | undefined;

  constructor(readonly storageFolder: string, private readonly settings: () => GodFileSettings = godFileSettings) {
    this.cache = new GodFileReportCache(storageFolder);
    this.subscriptions = [
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.restartIfStarted()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("reviewGuide.godFiles")) {
          this.restartIfStarted();
        }
      }),
    ];
  }

  // The first look at the view starts the work; until then a window without the view costs nothing.
  start(): void {
    if (!this.started) {
      this.started = true;
      void this.findRepos().then(() => this.measure(false));
    }
  }

  get maxItems(): number {
    return this.settings().maxItems;
  }

  foldersWithGit(): FolderGodFiles[] {
    return this.repoFolders.map((folder) => this.states.get(folder.uri.toString()) ?? { folder, state: "measuring" });
  }

  stateOf(folderUri: string): FolderGodFiles | undefined {
    return this.states.get(folderUri);
  }

  // Refresh: measured again, the cache aside, so the button always shows a fresh run.
  async refresh(): Promise<void> {
    this.started = true;
    await this.findRepos();
    await this.measure(true);
  }

  // Resolves when the reports are up to date; for tests.
  async measure(ignoreCache: boolean): Promise<void> {
    this.measureRequested = { ignoreCache: ignoreCache || this.measureRequested?.ignoreCache === true };
    this.running ??= this.measureWhileRequested().finally(() => {
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

  private restartIfStarted(): void {
    if (this.started) {
      void this.findRepos().then(() => this.measure(false));
    }
  }

  private async measureWhileRequested(): Promise<void> {
    while (this.measureRequested) {
      const { ignoreCache } = this.measureRequested;
      this.measureRequested = undefined;
      await this.measureAll(ignoreCache);
    }
  }

  private async measureAll(ignoreCache: boolean): Promise<void> {
    const settings = this.settings();
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Review Guide: measuring god files", cancellable: true },
      async (progress, cancellation) => {
        const abort = new AbortController();
        const listener = cancellation.onCancellationRequested(() => abort.abort());
        try {
          for (const folder of this.repoFolders) {
            progress.report({ message: folder.name });
            await this.measureFolder(folder, { ...settings, signal: abort.signal }, ignoreCache);
          }
        } finally {
          listener.dispose();
        }
      },
    );
  }

  private async measureFolder(folder: vscode.WorkspaceFolder, options: GodFileOptions, ignoreCache: boolean): Promise<void> {
    const key = folder.uri.toString();
    const repoFolder = folder.uri.fsPath;
    this.setState({ folder, state: "measuring" });
    try {
      const head = await headOf(repoFolder);
      const cached = ignoreCache || head === undefined ? undefined : this.cache.reportOf(repoFolder, head, options);
      const report = cached ?? await measureGodFiles(repoFolder, options);
      if (!cached) {
        this.cache.save(repoFolder, report, options);
      }
      this.setState({ folder, state: "ready", report });
    } catch (error) {
      const message = error instanceof MeasurementCancelled ? "Measuring was cancelled. Press Refresh to measure again." : error instanceof Error ? error.message : String(error);
      this.states.set(key, { folder, state: "failed", message });
      this.changed.fire();
    }
  }

  private setState(state: FolderGodFiles): void {
    this.states.set(state.folder.uri.toString(), state);
    this.changed.fire();
  }

  private async findRepos(): Promise<void> {
    const repos: vscode.WorkspaceFolder[] = [];
    const watchers: vscode.Disposable[] = [];
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const gitFolders = await gitFoldersOf(folder.uri.fsPath);
      if (gitFolders) {
        repos.push(folder);
        watchers.push(...this.watchHead(gitFolders));
      }
    }
    disposeAll(this.gitWatchers);
    this.gitWatchers = watchers;
    this.repoFolders = repos;
    for (const key of [...this.states.keys()]) {
      if (!repos.some((folder) => folder.uri.toString() === key)) {
        this.states.delete(key);
      }
    }
    this.changed.fire();
  }

  // HEAD moves with every commit, checkout and pull; git writes several files for one of them, so
  // one measurement a second after the last is enough.
  private watchHead(gitFolders: { gitFolder: string; commonFolder: string }): vscode.Disposable[] {
    const ownFiles = new vscode.RelativePattern(vscode.Uri.file(gitFolders.gitFolder), "{HEAD,logs/HEAD}");
    const sharedFiles = new vscode.RelativePattern(vscode.Uri.file(gitFolders.commonFolder), "{packed-refs,refs/heads/**}");
    return [ownFiles, sharedFiles].map((pattern) => {
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      const headMoved = () => {
        clearTimeout(this.debounce);
        this.debounce = setTimeout(() => void this.measure(false), 1000);
      };
      watcher.onDidCreate(headMoved);
      watcher.onDidChange(headMoved);
      watcher.onDidDelete(headMoved);
      return watcher;
    });
  }
}

async function headOf(repoFolder: string): Promise<string | undefined> {
  return readGit(repoFolder, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]).then((output) => output.trim(), () => undefined);
}

function disposeAll(disposables: vscode.Disposable[]): void {
  for (const disposable of disposables) {
    disposable.dispose();
  }
}
