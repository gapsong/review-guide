import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { withBadge } from "../codemap/badge";
import { watchHead } from "../codemap/workspaceChangeMarkers";
import { WorkspaceCodemaps } from "../codemap/workspaceCodemaps";
import { LanguageServer, measureBreadth, SymbolNode } from "../godfiles/breadth";
import { measureComplexity } from "../godfiles/complexity";
import { defaultGodFileOptions, godFileRules, GodFileItem, GodFileOptions, GodFileReport, hintOf, measureGodFiles, readFilesAt } from "../godfiles/godFiles";
import { languageOf } from "../godfiles/sourceFiles";
import { CodemapTarget, commandLink, uriOfTarget } from "./codemapTarget";
import { documentSymbolsOf } from "./documentSymbols";
import { contradictsCodemap, godFileTooltip, numbersLine } from "./godFileText";

// The God Files view in the Review Guide side bar: per workspace folder that is a git repo, the
// files where owning the repo hurts most, ranked by history and imports (src/godfiles).
//
//   ⚠ src/shop/checkout.py   god file? · 23 names used outside · 66 commits/90 d · changes with 9 areas · knows 4 areas · 1,176 lines
//
// The view measures the first time it is shown, again when HEAD moves (a commit, a checkout, a
// pull) or a setting changes, and on Refresh:
//
//   git (well under a second) ──► rows with their history numbers, at once
//        └─► for the rows shown: breadth from the language server, file by file, and cognitive
//            complexity from HEAD copies; each row fills in as its numbers arrive
//
// A new measurement cancels the one running. Nothing is cached and nothing is written anywhere.

// The view shows the top of the ranking; the tail is where owning hurts least.
const shownFiles = 20;

// One file's breadth: the language server's answers for all its names. The first file of a big
// project waits for the server to load the project.
const breadthTimeoutMilliseconds = 120_000;

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

// What the open command gets: the file, and the line to put the cursor on (1-based).
export type GodFileLocation = CodemapTarget & { line?: number };

export function godFileSettings(): GodFileOptions {
  const settings = vscode.workspace.getConfiguration("reviewGuide.godFiles");
  return { minCodeLines: settings.get<number>("minLines", defaultGodFileOptions.minCodeLines), exclude: settings.get<string[]>("exclude", []) };
}

function complexipyPath(): string {
  return vscode.workspace.getConfiguration("reviewGuide").get<string>("complexipyPath", "complexipy") || "complexipy";
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
  // One measurement at a time; a request during one cancels it and runs one more after it.
  private running: Promise<void> | undefined;
  private measureRequested = false;
  private toldHowToInstallComplexipy = false;

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
        if (event.affectsConfiguration("reviewGuide.godFiles") || event.affectsConfiguration("reviewGuide.complexipyPath")) {
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
    const hint = hintOf(godFile);
    const mark = hint === "god file?" ? "⚠ " : hint === "deep" ? "✓ " : "";
    const item = new vscode.TreeItem(`${mark}${entry ? withBadge(entry, godFile.path) : godFile.path}`, vscode.TreeItemCollapsibleState.None);
    const warning = contradictsCodemap(godFile, entry) ? "⚠️ codemap says deep · " : "";
    item.description = `${warning}${hint ? `${hint} · ` : ""}${numbersLine(godFile)}`;
    item.contextValue = "godFile";
    item.resourceUri = uriOfTarget(element);
    const open = openAction(element);
    item.command = { title: open.title, command: godFileCommands.open, arguments: [open.location] };
    item.accessibilityInformation = { label: `${godFile.path}, ${hint ?? "no hint"}: ${numbersLine(godFile)}` };
    return item;
  }

  // The tooltip is built only when it is shown.
  resolveTreeItem(item: vscode.TreeItem, element: GodFilesViewNode): vscode.TreeItem {
    if (element.kind === "file") {
      const target = { folderUri: element.folderUri, path: element.path };
      const open = openAction(element);
      const actions = [
        { title: open.title, link: commandLink(godFileCommands.open, open.location) },
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

  // A request that comes in while measuring cancels the rest of this round: the language server
  // work stops at the next file or name, and the loop starts over with the new HEAD and settings.
  private async measureWhileRequested(): Promise<void> {
    while (this.measureRequested) {
      this.measureRequested = false;
      const isCancelled = () => this.measureRequested;
      const options = godFileSettings();
      await vscode.window.withProgress({ location: { viewId: GodFilesView.viewId } }, async () => {
        const ready: Extract<FolderGodFiles, { state: "ready" }>[] = [];
        for (const folder of this.repoFolders) {
          this.setState({ folder, state: "measuring" });
          try {
            const state = { folder, state: "ready" as const, report: await measureGodFiles(folder.uri.fsPath, options) };
            this.setState(state);
            ready.push(state);
          } catch (error) {
            this.setState({ folder, state: "failed", message: error instanceof Error ? error.message : String(error) });
          }
        }
        for (const state of ready) {
          if (!isCancelled()) {
            await Promise.all([this.measureBreadthOfShown(state, isCancelled), this.measureComplexityOfShown(state)]);
          }
        }
      });
    }
  }

  // File by file in rank order, so the top rows fill in first.
  private async measureBreadthOfShown(state: Extract<FolderGodFiles, { state: "ready" }>, isCancelled: () => boolean): Promise<void> {
    const server = languageServerOf(state.folder);
    const measured = new Set(state.report.sourcePaths);
    for (const item of state.report.items.slice(0, shownFiles)) {
      const breadth = await measureBreadth(item.path, server, { measured, stopAbove: godFileRules.broadAboveNamesUsedOutside, timeoutMilliseconds: breadthTimeoutMilliseconds, isCancelled });
      if (breadth === undefined || isCancelled()) {
        return;
      }
      this.update(state, item.path, { breadth });
    }
  }

  // Cognitive complexity of the HEAD texts; a missing complexipy is named once per window.
  private async measureComplexityOfShown(state: Extract<FolderGodFiles, { state: "ready" }>): Promise<void> {
    const { report } = state;
    const texts = await readFilesAt(state.folder.uri.fsPath, report.commit, report.items.slice(0, shownFiles).map((item) => item.path));
    const results = await measureComplexity(texts, complexipyPath());
    for (const [repoPath, complexity] of results) {
      this.update(state, repoPath, { complexity });
    }
    const missing = [...results.values()].find((complexity) => complexity.state === "unknown" && complexity.missingTool);
    if (missing?.state === "unknown" && !this.toldHowToInstallComplexipy) {
      this.toldHowToInstallComplexipy = true;
      void vscode.window.showInformationMessage(`God Files: cognitive complexity of Python files needs complexipy. ${missing.reason}`);
    }
  }

  // A measured number of one row; the report is the one the view still shows, or nothing happens.
  private update(state: Extract<FolderGodFiles, { state: "ready" }>, repoPath: string, numbers: Partial<Pick<GodFileItem, "breadth" | "complexity">>): void {
    if (this.states.get(state.folder.uri.toString()) !== state) {
      return;
    }
    const index = state.report.items.findIndex((item) => item.path === repoPath);
    if (index !== -1) {
      state.report.items[index] = { ...state.report.items[index], ...numbers };
      this.redraw();
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

  // "538 source files · 307 commits in 90 days · ranked by history and imports, never by length"
  private messageLine(): string | undefined {
    const ready = [...this.states.values()].filter((state): state is Extract<FolderGodFiles, { state: "ready" }> => state.state === "ready");
    if (ready.length !== 1 || this.repoFolders.length !== 1) {
      return undefined;
    }
    const { report } = ready[0];
    const cut = report.historyIsCut ? " (shallow clone: older commits are missing)" : "";
    const shown = report.items.slice(0, shownFiles);
    const pending = shown.filter((item) => item.breadth.state === "pending").length;
    const progress = pending > 0 ? ` · names used outside: ${shown.length - pending} of ${shown.length} measured` : "";
    return `${report.sourcePaths.length} source files · ${report.commitCount} commits in ${godFileRules.days} days${cut} · ranked by history and imports, never by length${progress}`;
  }
}

// The click on a row: the file at its hardest function, once that is measured.
function openAction(node: Extract<GodFilesViewNode, { kind: "file" }>): { title: string; location: GodFileLocation } {
  const { complexity } = node.item;
  const hardest = complexity.state === "known" ? complexity.hardest : undefined;
  const location = { folderUri: node.folderUri, path: node.path, line: hardest?.line };
  return { title: hardest ? `Open at the hardest function (${hardest.name})` : "Open", location };
}

// VS Code's language servers, for the files of one workspace folder ("Find All References").
function languageServerOf(folder: vscode.WorkspaceFolder): LanguageServer {
  const root = folder.uri.fsPath;
  const uriOf = (repoPath: string) => vscode.Uri.joinPath(folder.uri, ...repoPath.split("/"));
  const repoPathOf = (uri: vscode.Uri) => {
    const relative = path.relative(root, uri.fsPath);
    return uri.scheme !== "file" || relative.startsWith("..") || path.isAbsolute(relative) ? undefined : relative.split(path.sep).join("/");
  };
  const nodeOf = (symbol: vscode.DocumentSymbol): SymbolNode => ({
    name: symbol.name,
    isClass: symbol.kind === vscode.SymbolKind.Class,
    line: symbol.selectionRange.start.line,
    character: symbol.selectionRange.start.character,
    children: (symbol.children ?? []).map(nodeOf),
  });
  return {
    symbols: async (repoPath) => (await documentSymbolsOf(uriOf(repoPath)))?.map(nodeOf),
    // VS Code's TypeScript extension sends references to its syntax server, which knows only the open
    // files, until the project has loaded. A semantic request waits for the load: the server runs
    // one request at a time. Other languages have no such mode here.
    ready: async (repoPath) => {
      if (languageOf(repoPath) === "typescript") {
        await vscode.commands.executeCommand("typescript.tsserverRequest", "semanticDiagnosticsSync", { file: uriOf(repoPath) }).then(undefined, () => undefined);
      }
    },
    references: async (repoPath, line, character) => {
      const locations = await vscode.commands.executeCommand<vscode.Location[] | undefined>("vscode.executeReferenceProvider", uriOf(repoPath), new vscode.Position(line, character));
      return (locations ?? []).map((location) => ({ path: repoPathOf(location.uri), line: location.range.start.line }));
    },
    // An open document may hold unsaved changes the language server answers about; any other file
    // is read from disk without opening it, so no language server starts work on it.
    text: async (repoPath) => {
      const uri = uriOf(repoPath);
      const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
      return open ? open.getText() : fs.promises.readFile(uri.fsPath, "utf8");
    },
  };
}

// Opens the file, at the given line when there is one.
export async function openGodFile(location: GodFileLocation): Promise<void> {
  const editor = await vscode.window.showTextDocument(uriOfTarget(location), { preview: true });
  if (location.line !== undefined && Number.isInteger(location.line) && location.line >= 1) {
    const start = new vscode.Position(Math.min(location.line, editor.document.lineCount) - 1, 0);
    editor.selection = new vscode.Selection(start, start);
    editor.revealRange(new vscode.Range(start, start), vscode.TextEditorRevealType.AtTop);
  }
}

function disposeAll(disposables: vscode.Disposable[]): void {
  for (const disposable of disposables) {
    disposable.dispose();
  }
}
