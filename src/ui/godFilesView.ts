import * as vscode from "vscode";
import { withBadge } from "../codemap/badge";
import { watchHead } from "../codemap/workspaceChangeMarkers";
import { WorkspaceCodemaps } from "../codemap/workspaceCodemaps";
import { defaultGodFileOptions, godFileRules, GodFileItem, GodFileOptions, GodFileReport, measureGodFiles } from "../godfiles/godFiles";
import { CodemapTarget, commandLink, uriOfTarget } from "./codemapTarget";
import { readSymbols } from "./documentSymbols";
import { contradictsCodemap, godFileTooltip, numbersLine } from "./godFileText";

// The God Files view in the Review Guide side bar: per workspace folder that is a git repo, the
// files where owning the repo hurts most, ranked by breadth and history (src/godfiles).
//
//   ⚠ src/shop/checkout.py   god file? · 23 names used outside · 66 commits/90 d · changes with 9 areas · 1,176 lines
//
// The view measures the first time it is shown, again when HEAD moves (a commit, a checkout, a
// pull) or a setting changes, and on Refresh. Measuring takes well under a second, so nothing is
// cached and nothing is written anywhere.

// The view shows the top of the ranking; the tail is where owning hurts least.
const shownFiles = 20;

export const godFileCommands = {
  refresh: "reviewGuide.godFiles.refresh",
  open: "reviewGuide.godFiles.open",
  judge: "reviewGuide.godFiles.judge",
};

type FolderGodFiles =
  | { folder: vscode.WorkspaceFolder; state: "measuring" }
  | { folder: vscode.WorkspaceFolder; state: "ready"; report: GodFileReport }
  | { folder: vscode.WorkspaceFolder; state: "failed"; message: string };

// A file node is a CodemapTarget (folder and repo path, plain JSON), so a tooltip link can pass it on.
export type GodFilesViewNode =
  | { kind: "workspaceFolder"; folder: vscode.WorkspaceFolder }
  | { kind: "message"; text: string; icon: string }
  | ({ kind: "file"; item: GodFileItem } & CodemapTarget);

export function godFileSettings(): GodFileOptions {
  const settings = vscode.workspace.getConfiguration("reviewGuide.godFiles");
  return { minCodeLines: settings.get<number>("minLines", defaultGodFileOptions.minCodeLines), exclude: settings.get<string[]>("exclude", []) };
}

export class GodFilesView implements vscode.TreeDataProvider<GodFilesViewNode>, vscode.Disposable {
  static readonly viewId = "reviewGuide.godFiles";
  private readonly changed = new vscode.EventEmitter<GodFilesViewNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly treeView: vscode.TreeView<GodFilesViewNode>;
  private readonly states = new Map<string, FolderGodFiles>();
  private repoFolders: vscode.WorkspaceFolder[] = [];
  private gitWatchers: vscode.Disposable[] = [];
  private readonly subscriptions: vscode.Disposable[];
  private started = false;
  private debounce: NodeJS.Timeout | undefined;
  // One measurement at a time; a request during one runs one more after it.
  private running: Promise<void> | undefined;
  private measureRequested = false;

  constructor(private readonly codemaps: WorkspaceCodemaps) {
    this.treeView = vscode.window.createTreeView(GodFilesView.viewId, { treeDataProvider: this });
    const restartIfStarted = () => {
      if (this.started) {
        void this.refresh();
      }
    };
    this.subscriptions = [
      codemaps.onDidChange(() => this.redraw()),
      // The first look at the view starts the work; until then a window without the view costs nothing.
      this.treeView.onDidChangeVisibility((event) => {
        if (event.visible && !this.started) {
          void this.refresh();
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(restartIfStarted),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("reviewGuide.godFiles")) {
          restartIfStarted();
        }
      }),
    ];
    if (this.treeView.visible) {
      void this.refresh();
    }
  }

  get message(): string | undefined {
    return this.treeView.message;
  }

  // The measured file and its report, when the view has measured the path.
  measured(target: CodemapTarget): { item: GodFileItem; report: GodFileReport } | undefined {
    const state = this.states.get(target.folderUri);
    const item = state?.state === "ready" ? state.report.items.find((candidate) => candidate.path === target.path) : undefined;
    return state?.state === "ready" && item ? { item, report: state.report } : undefined;
  }

  // Finds the git repos among the workspace folders and measures them; resolves when the view is up to date.
  async refresh(): Promise<void> {
    this.started = true;
    await this.findRepos();
    await this.measure();
  }

  getChildren(element?: GodFilesViewNode): GodFilesViewNode[] {
    if (!element) {
      const folders = this.repoFolders.map((folder) => this.states.get(folder.uri.toString()) ?? { folder, state: "measuring" as const });
      return folders.length === 1 ? this.nodesOf(folders[0]) : folders.map(({ folder }) => ({ kind: "workspaceFolder", folder }));
    }
    if (element.kind === "workspaceFolder") {
      const state = this.states.get(element.folder.uri.toString());
      return state ? this.nodesOf(state) : [{ kind: "message", text: "Measuring…", icon: "loading~spin" }];
    }
    return [];
  }

  getTreeItem(element: GodFilesViewNode): vscode.TreeItem {
    if (element.kind === "workspaceFolder") {
      const item = new vscode.TreeItem(element.folder.name, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = new vscode.ThemeIcon("root-folder");
      return item;
    }
    if (element.kind === "message") {
      const item = new vscode.TreeItem(element.text, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon(element.icon);
      item.tooltip = element.text;
      return item;
    }
    const { item: godFile } = element;
    const entry = this.codemaps.entryOf(uriOfTarget(element));
    const mark = godFile.hint === "god file?" ? "⚠ " : godFile.hint === "deep" ? "✓ " : "";
    const item = new vscode.TreeItem(`${mark}${entry ? withBadge(entry, godFile.path) : godFile.path}`, vscode.TreeItemCollapsibleState.None);
    const warning = contradictsCodemap(godFile, entry) ? "⚠️ codemap says deep · " : "";
    item.description = `${warning}${godFile.hint ? `${godFile.hint} · ` : ""}${numbersLine(godFile)}`;
    item.contextValue = "godFile";
    item.resourceUri = uriOfTarget(element);
    item.command = { title: "Open at the longest function", command: godFileCommands.open, arguments: [{ folderUri: element.folderUri, path: element.path }] };
    item.accessibilityInformation = { label: `${godFile.path}, ${godFile.hint ?? "no hint"}: ${numbersLine(godFile)}` };
    return item;
  }

  // The tooltip is built only when it is shown.
  resolveTreeItem(item: vscode.TreeItem, element: GodFilesViewNode): vscode.TreeItem {
    if (element.kind === "file") {
      const target = { folderUri: element.folderUri, path: element.path };
      const actions = [
        { title: "Open at the longest function", link: commandLink(godFileCommands.open, target) },
        { title: "Judge with Claude", link: commandLink(godFileCommands.judge, target) },
      ];
      const tooltip = new vscode.MarkdownString(godFileTooltip({ item: element.item, entry: this.codemaps.entryOf(uriOfTarget(element)), actions }), true);
      tooltip.isTrusted = { enabledCommands: [godFileCommands.open, godFileCommands.judge] };
      item.tooltip = tooltip;
    }
    return item;
  }

  dispose(): void {
    clearTimeout(this.debounce);
    disposeAll(this.gitWatchers);
    disposeAll(this.subscriptions);
    this.treeView.dispose();
    this.changed.dispose();
  }

  private async measure(): Promise<void> {
    this.measureRequested = true;
    this.running ??= this.measureWhileRequested().finally(() => {
      this.running = undefined;
    });
    await this.running;
  }

  private async measureWhileRequested(): Promise<void> {
    while (this.measureRequested) {
      this.measureRequested = false;
      const options = godFileSettings();
      await vscode.window.withProgress({ location: { viewId: GodFilesView.viewId } }, async () => {
        for (const folder of this.repoFolders) {
          this.setState({ folder, state: "measuring" });
          try {
            this.setState({ folder, state: "ready", report: await measureGodFiles(folder.uri.fsPath, options) });
          } catch (error) {
            this.setState({ folder, state: "failed", message: error instanceof Error ? error.message : String(error) });
          }
        }
      });
    }
  }

  private setState(state: FolderGodFiles): void {
    this.states.set(state.folder.uri.toString(), state);
    this.redraw();
  }

  private redraw(): void {
    this.treeView.message = this.messageLine();
    this.changed.fire(undefined);
  }

  // HEAD moves with every commit, checkout and pull; git writes several files for one of them, so
  // one measurement a second after the last is enough.
  private async findRepos(): Promise<void> {
    const repos: vscode.WorkspaceFolder[] = [];
    const watchers: vscode.Disposable[] = [];
    const headMoved = () => {
      clearTimeout(this.debounce);
      this.debounce = setTimeout(() => void this.measure(), 1000);
    };
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const folderWatchers = await watchHead(folder.uri.fsPath, headMoved);
      if (folderWatchers) {
        repos.push(folder);
        watchers.push(...folderWatchers);
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
    this.redraw();
  }

  private nodesOf(state: FolderGodFiles): GodFilesViewNode[] {
    if (state.state === "measuring") {
      return [{ kind: "message", text: "Measuring…", icon: "loading~spin" }];
    }
    if (state.state === "failed") {
      return [{ kind: "message", text: state.message, icon: "error" }];
    }
    if (state.report.items.length === 0) {
      return [{ kind: "message", text: `No source file has ${state.report.minCodeLines} code lines or more.`, icon: "info" }];
    }
    const folderUri = state.folder.uri.toString();
    return state.report.items.slice(0, shownFiles).map((item) => ({ kind: "file", item, folderUri, path: item.path }));
  }

  // "538 source files · 307 commits in 90 days · ranked by breadth and history, never by length"
  private messageLine(): string | undefined {
    const ready = [...this.states.values()].filter((state): state is Extract<FolderGodFiles, { state: "ready" }> => state.state === "ready");
    if (ready.length !== 1 || this.repoFolders.length !== 1) {
      return undefined;
    }
    const { report } = ready[0];
    const cut = report.historyIsCut ? " (shallow clone: older commits are missing)" : "";
    return `${report.sourceFileCount} source files · ${report.commitCount} commits in ${godFileRules.days} days${cut} · ranked by breadth and history, never by length`;
  }
}

// Opens the file at once, then moves to its longest function when the language server knows the
// file's symbols: only this one file is asked, and only on the click.
export async function openAtLongestFunction(target: CodemapTarget): Promise<void> {
  const uri = uriOfTarget(target);
  const editor = await vscode.window.showTextDocument(uri, { preview: true });
  const functions = ((await readSymbols(uri.fsPath)) ?? []).filter((symbol) => symbol.kind === "function");
  if (functions.length === 0) {
    return;
  }
  const longest = functions.reduce((best, symbol) => (symbol.endLine - symbol.startLine > best.endLine - best.startLine ? symbol : best));
  const start = new vscode.Position(longest.startLine - 1, 0);
  if (vscode.window.activeTextEditor?.document.uri.toString() === uri.toString()) {
    editor.selection = new vscode.Selection(start, start);
    editor.revealRange(new vscode.Range(start, start), vscode.TextEditorRevealType.AtTop);
  }
}

function disposeAll(disposables: vscode.Disposable[]): void {
  for (const disposable of disposables) {
    disposable.dispose();
  }
}
