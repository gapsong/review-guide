import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { badgeOf } from "../codemap/badge";
import { CodemapEntry, startLocationOf } from "../codemap/codemap";
import { buildCodemapTree, CodemapFilter, CodemapTreeNode } from "../codemap/codemapTree";
import { explanationPageOf } from "../codemap/explanationFiles";
import { WorkspaceCodemaps } from "../codemap/workspaceCodemaps";
import { isDirectory } from "./codemapNavigation";
import { CodemapTarget, commandLink, targetOf } from "./codemapTarget";
import { codemapTooltip, EntryStatus, TooltipLink } from "./codemapTooltip";

// The Codemap view in the Explorer: the codemap as a tree, with each entry's badge and sentence.
// It is the main place to read the codemap: VS Code's Explorer hides a folder's badge while the
// folder holds changed files (DECISIONS.md).

// A node of the view. Every node except a workspace folder is a CodemapTarget, so the view's
// inline actions can pass it to the same commands as a tooltip link or a CodeLens.
export type CodemapViewNode =
  | { kind: "workspaceFolder"; folder: vscode.WorkspaceFolder }
  | ({ kind: "path"; node: CodemapTreeNode } & CodemapTarget);

export const codemapCommands = {
  open: "reviewGuide.codemap.open",
  openStart: "reviewGuide.codemap.openStart",
  explain: "reviewGuide.codemap.explain",
} as const;

const filterDescriptions: Record<CodemapFilter, string | undefined> = {
  all: undefined,
  money: "💰 money only",
  security: "🔒 security only",
  deep: "🧠 deep modules only",
};

export class CodemapView implements vscode.TreeDataProvider<CodemapViewNode>, vscode.Disposable {
  static readonly viewId = "reviewGuide.codemap";
  private readonly changed = new vscode.EventEmitter<CodemapViewNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly treeView: vscode.TreeView<CodemapViewNode>;
  private filter: CodemapFilter = "all";

  constructor(private readonly codemaps: WorkspaceCodemaps) {
    this.treeView = vscode.window.createTreeView(CodemapView.viewId, { treeDataProvider: this, showCollapseAll: true });
    codemaps.onDidChange(() => this.refresh());
    void this.updateContext();
  }

  get currentFilter(): CodemapFilter {
    return this.filter;
  }

  setFilter(filter: CodemapFilter): void {
    this.filter = filter;
    this.treeView.description = filterDescriptions[filter];
    this.refresh();
  }

  refresh(): void {
    void this.updateContext();
    this.changed.fire(undefined);
  }

  getChildren(element?: CodemapViewNode): CodemapViewNode[] {
    if (!element) {
      const folders = this.codemaps.foldersWithCodemap();
      // With one codemap, its entries are the top of the tree; with several, each folder is.
      return folders.length === 1 ? this.pathNodesOf(folders[0]) : folders.map((folder) => ({ kind: "workspaceFolder", folder }));
    }
    if (element.kind === "workspaceFolder") {
      return this.pathNodesOf(element.folder);
    }
    return element.node.children.map((node) => pathNode(element, node));
  }

  getTreeItem(element: CodemapViewNode): vscode.TreeItem {
    if (element.kind === "workspaceFolder") {
      const item = new vscode.TreeItem(element.folder.name, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = new vscode.ThemeIcon("root-folder");
      return item;
    }
    const { node } = element;
    const collapsible = node.children.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None;
    if (!node.entry) {
      const item = new vscode.TreeItem(node.name, collapsible);
      item.iconPath = new vscode.ThemeIcon("folder", new vscode.ThemeColor("descriptionForeground"));
      item.tooltip = node.path;
      return item;
    }
    const item = new vscode.TreeItem(`${badgeOf(node.entry)} ${node.name}`, collapsible);
    item.description = node.entry.says;
    item.contextValue = "codemapEntry";
    item.command = { title: "Open", command: codemapCommands.open, arguments: [element] };
    item.accessibilityInformation = { label: `${node.name}, ${node.entry.label}${node.entry.deep ? ", deep module" : ""}: ${node.entry.says}` };
    return item;
  }

  // The tooltip is built only when it is shown: it looks at the explanation on disk.
  resolveTreeItem(item: vscode.TreeItem, element: CodemapViewNode): vscode.TreeItem {
    if (element.kind === "path" && element.node.entry) {
      item.tooltip = this.tooltipOf(element, element.node.entry);
    }
    return item;
  }

  dispose(): void {
    this.treeView.dispose();
    this.changed.dispose();
  }

  private pathNodesOf(folder: vscode.WorkspaceFolder): CodemapViewNode[] {
    const isFolder = (repoPath: string) => isDirectory(path.join(folder.uri.fsPath, repoPath));
    const tree = buildCodemapTree(this.codemaps.entriesOf(folder), this.filter, isFolder);
    const parent = targetOf(folder, "");
    return tree.map((node) => pathNode(parent, node));
  }

  private tooltipOf(target: CodemapTarget, entry: CodemapEntry): vscode.MarkdownString {
    const actions: TooltipLink[] = [{ title: "Explain", link: commandLink(codemapCommands.explain, target) }];
    const markdown = codemapTooltip({
      name: path.posix.basename(entry.path),
      entry,
      status: this.statusOf(target),
      startLink: entry.start !== undefined && startLocationOf(entry.start) ? commandLink(codemapCommands.openStart, target) : undefined,
      actions,
    });
    const tooltip = new vscode.MarkdownString(markdown);
    tooltip.isTrusted = { enabledCommands: Object.values(codemapCommands) };
    return tooltip;
  }

  private statusOf(target: CodemapTarget): EntryStatus {
    const page = vscode.Uri.joinPath(vscode.Uri.parse(target.folderUri), explanationPageOf(target.path)).fsPath;
    return { explanationWritten: fs.existsSync(page) ? fs.statSync(page).mtime : undefined };
  }

  // The view's welcome text depends on these (package.json, viewsWelcome).
  private async updateContext(): Promise<void> {
    await vscode.commands.executeCommand("setContext", "reviewGuide.hasCodemap", this.codemaps.foldersWithCodemap().length > 0);
    await vscode.commands.executeCommand("setContext", "reviewGuide.codemapFilter", this.filter);
  }
}

function pathNode(parent: CodemapTarget, node: CodemapTreeNode): CodemapViewNode {
  return { kind: "path", node, folderUri: parent.folderUri, path: node.path };
}
