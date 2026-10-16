import * as vscode from "vscode";
import { withBadge } from "../codemap/badge";
import { WorkspaceCodemaps } from "../codemap/workspaceCodemaps";
import { GodFileItem, GodFileReport } from "../godfiles/godFiles";
import { CodemapTarget, commandLink, uriOfTarget } from "./codemapTarget";
import { readSymbols } from "./documentSymbols";
import { TooltipLink } from "./codemapTooltip";
import { contradictsCodemap, godFileTooltip, numbersLine } from "./godFileText";
import { FolderGodFiles, WorkspaceGodFiles } from "./workspaceGodFiles";

// The God Files view in the Review Guide side bar: per workspace folder that is a git repo, the
// files where owning the repo hurts most, ranked by breadth and history (src/godfiles).
//
//   ⚠ src/shop/checkout.py   god file? · 23 names used by 41 files · 66 commits/90 d · changes with 9 areas · 1,176 lines

export const godFileCommands = {
  refresh: "reviewGuide.godFiles.refresh",
  open: "reviewGuide.godFiles.open",
  judge: "reviewGuide.godFiles.judge",
  showDetails: "reviewGuide.godFiles.showDetails",
};

// A file node is a CodemapTarget (folder and repo path, plain JSON), so a tooltip link can pass it on.
export type GodFilesViewNode =
  | { kind: "workspaceFolder"; folder: vscode.WorkspaceFolder }
  | { kind: "message"; text: string; icon: string }
  | ({ kind: "file"; item: GodFileItem; rank: number } & CodemapTarget);

export class GodFilesView implements vscode.TreeDataProvider<GodFilesViewNode>, vscode.Disposable {
  static readonly viewId = "reviewGuide.godFiles";
  private readonly changed = new vscode.EventEmitter<GodFilesViewNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly treeView: vscode.TreeView<GodFilesViewNode>;

  constructor(private readonly godFiles: WorkspaceGodFiles, private readonly codemaps: WorkspaceCodemaps) {
    this.treeView = vscode.window.createTreeView(GodFilesView.viewId, { treeDataProvider: this });
    godFiles.onDidChange(() => this.refresh());
    codemaps.onDidChange(() => this.refresh());
    this.treeView.onDidChangeVisibility((event) => {
      if (event.visible) {
        godFiles.start();
      }
    });
    if (this.treeView.visible) {
      godFiles.start();
    }
  }

  refresh(): void {
    this.treeView.message = this.messageLine();
    this.changed.fire(undefined);
  }

  get message(): string | undefined {
    return this.treeView.message;
  }

  getChildren(element?: GodFilesViewNode): GodFilesViewNode[] {
    if (!element) {
      const folders = this.godFiles.foldersWithGit();
      if (folders.length === 1) {
        return this.nodesOf(folders[0]);
      }
      return folders.map(({ folder }) => ({ kind: "workspaceFolder", folder }));
    }
    if (element.kind === "workspaceFolder") {
      const state = this.godFiles.stateOf(element.folder.uri.toString());
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
    const state = this.godFiles.stateOf(element.folderUri);
    const days = state?.state === "ready" ? state.report.days : 90;
    const entry = this.codemaps.entryOf(uriOfTarget(element));
    const name = entry ? withBadge(entry, godFile.path) : godFile.path;
    const item = new vscode.TreeItem(`${markOf(godFile)}${name}`, vscode.TreeItemCollapsibleState.None);
    const warning = contradictsCodemap(godFile, entry) ? "⚠️ codemap says deep · " : "";
    item.description = `${warning}${godFile.hint ? `${godFile.hint} · ` : ""}${numbersLine(godFile, days)}`;
    item.contextValue = "godFile";
    item.resourceUri = uriOfTarget(element);
    item.command = { title: "Open at the longest function", command: godFileCommands.open, arguments: [targetOfNode(element)] };
    item.accessibilityInformation = { label: `${godFile.path}, ${godFile.hint ?? "no hint"}: ${numbersLine(godFile, days)}` };
    return item;
  }

  // The tooltip is built only when it is shown.
  resolveTreeItem(item: vscode.TreeItem, element: GodFilesViewNode): vscode.TreeItem {
    if (element.kind === "file") {
      const state = this.godFiles.stateOf(element.folderUri);
      if (state?.state === "ready") {
        item.tooltip = this.tooltipOf(element, state.report);
      }
    }
    return item;
  }

  tooltipOf(element: Extract<GodFilesViewNode, { kind: "file" }>, report: GodFileReport): vscode.MarkdownString {
    const target = targetOfNode(element);
    const actions: TooltipLink[] = [
      { title: "Open at the longest function", link: commandLink(godFileCommands.open, target) },
      { title: "Details and Judge with Claude", link: commandLink(godFileCommands.showDetails, target) },
    ];
    const markdown = godFileTooltip({ item: element.item, report, rank: element.rank, entry: this.codemaps.entryOf(uriOfTarget(element)), actions });
    const tooltip = new vscode.MarkdownString(markdown, true);
    tooltip.isTrusted = { enabledCommands: [godFileCommands.open, godFileCommands.showDetails] };
    return tooltip;
  }

  dispose(): void {
    this.treeView.dispose();
    this.changed.dispose();
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
    return state.report.items.slice(0, this.godFiles.maxItems).map((item, index) => ({ kind: "file", item, rank: index + 1, folderUri, path: item.path }));
  }

  // "538 source files · 307 commits in 90 days · ranked by breadth and history, never by length"
  private messageLine(): string | undefined {
    const ready = this.godFiles.foldersWithGit().filter((state): state is Extract<FolderGodFiles, { state: "ready" }> => state.state === "ready");
    if (ready.length !== 1) {
      return undefined;
    }
    const { report } = ready[0];
    const cut = report.historyIsCut ? " (shallow clone: older commits are missing)" : "";
    return `${report.sourceFileCount} source files · ${report.commitCount} commits in ${report.days} days${cut} · ranked by breadth and history, never by length`;
  }
}

function markOf(item: GodFileItem): string {
  if (item.hint === "god file?") {
    return "⚠ ";
  }
  return item.hint === "deep" ? "✓ " : "";
}

export function targetOfNode(node: CodemapTarget): CodemapTarget {
  return { folderUri: node.folderUri, path: node.path };
}

// Opens the file at once, then moves to its longest function when the language server knows the
// file's symbols: only this one file is asked, and only on the click.
export async function openAtLongestFunction(target: CodemapTarget): Promise<void> {
  const uri = uriOfTarget(target);
  const editor = await vscode.window.showTextDocument(uri, { preview: true });
  const symbols = (await readSymbols(uri.fsPath)) ?? [];
  const functions = symbols.filter((symbol) => symbol.kind === "function");
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
