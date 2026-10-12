import * as path from "path";
import * as vscode from "vscode";
import { withBadge } from "../codemap/badge";
import { CodemapEntry, startLocationOf } from "../codemap/codemap";
import { buildCodemapTree, CodemapFilter, CodemapTreeNode } from "../codemap/codemapTree";
import { changeText } from "../codemap/changeMarkers";
import { CodemapLabel } from "../codemap/codemap";
import { describeThreeAmCheck, isOwned, threeAmLabels } from "../codemap/entryOwnership";
import { WorkspaceChangeMarkers } from "../codemap/workspaceChangeMarkers";
import { WorkspaceCodemaps } from "../codemap/workspaceCodemaps";
import { WorkspaceEntryOwnership } from "../codemap/workspaceEntryOwnership";
import { codemapCommands } from "./codemapCommands";
import { isDirectory } from "./codemapNavigation";
import { CodemapTarget, commandLink, targetOf, uriOfTarget } from "./codemapTarget";
import { codemapTooltip, TooltipLink } from "./codemapTooltip";
import { entryStatusOf } from "./entryStatus";

// The Codemap view in the Explorer: the codemap as a tree, with each entry's badge and sentence.
// It is the main place to read the codemap: VS Code's Explorer hides a folder's badge while the
// folder holds changed files (DECISIONS.md).

// A node of the view. Every node except a workspace folder is a CodemapTarget, so the view's
// inline actions can pass it to the same commands as a tooltip link or a CodeLens.
export type CodemapViewNode =
  | { kind: "workspaceFolder"; folder: vscode.WorkspaceFolder }
  | ({ kind: "path"; node: CodemapTreeNode } & CodemapTarget);

const filterDescriptions: Record<CodemapFilter, string | undefined> = {
  all: undefined,
  money: "💰 money only",
  security: "🔒 security only",
  deep: "🧠 deep modules only",
  unowned: "🎯 not owned yet",
};

// The 3am line counts the money and security entries; with one of them as the filter, only that one.
const threeAmLabelsOf: Record<CodemapFilter, CodemapLabel[]> = {
  all: threeAmLabels,
  money: ["money"],
  security: ["security"],
  deep: threeAmLabels,
  unowned: threeAmLabels,
};

export class CodemapView implements vscode.TreeDataProvider<CodemapViewNode>, vscode.Disposable {
  static readonly viewId = "reviewGuide.codemap";
  private readonly changed = new vscode.EventEmitter<CodemapViewNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly treeView: vscode.TreeView<CodemapViewNode>;
  private filter: CodemapFilter = "all";

  constructor(
    private readonly codemaps: WorkspaceCodemaps,
    private readonly markers: WorkspaceChangeMarkers,
    private readonly ownership: WorkspaceEntryOwnership,
  ) {
    this.treeView = vscode.window.createTreeView(CodemapView.viewId, { treeDataProvider: this, showCollapseAll: true });
    codemaps.onDidChange(() => this.refresh());
    markers.onDidChange(() => this.refresh());
    ownership.onDidChange(() => this.refresh());
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
    this.treeView.message = this.threeAmLine();
    this.changed.fire(undefined);
  }

  // The view's message above the tree: "3am 💰🔒: 2 of 9 owned · 1 changed · … · next: payment.py".
  get message(): string | undefined {
    return this.treeView.message;
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
    const item = new vscode.TreeItem(withBadge(node.entry, node.name), collapsible);
    const status = entryStatusOf(element, this.markers, this.ownership);
    const change = status.change;
    const owned = status.ownership !== undefined && isOwned(status.ownership);
    // The marker leads the description: an icon in front would push the row out of line with the
    // others, and the emoji keeps its color in the grey description text. At most one prefix, the
    // marker first: an entry that is not owned stays quiet, its state is in the tooltip.
    item.description = change ? `⚠️\u2002changed · ${node.entry.says}` : owned ? `✅\u2002owned · ${node.entry.says}` : node.entry.says;
    item.contextValue = change ? "codemapEntryChanged" : "codemapEntry";
    item.command = { title: "Open", command: codemapCommands.open, arguments: [element] };
    const changed = change ? `, ${changeText(change).toLowerCase()}` : "";
    const ownedText = owned ? ", owned" : "";
    item.accessibilityInformation = { label: `${node.name}, ${node.entry.label}${node.entry.deep ? ", deep module" : ""}${changed}${ownedText}: ${node.entry.says}` };
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
    const isOwnedEntry = (entry: CodemapEntry) => {
      const state = this.ownership.stateOf(uriOfTarget(targetOf(folder, entry.path)));
      return state !== undefined && isOwned(state);
    };
    const tree = buildCodemapTree(this.codemaps.entriesOf(folder), this.filter, isFolder, isOwnedEntry);
    const parent = targetOf(folder, "");
    return tree.map((node) => pathNode(parent, node));
  }

  private tooltipOf(target: CodemapTarget, entry: CodemapEntry): vscode.MarkdownString {
    const status = entryStatusOf(target, this.markers, this.ownership);
    const ownIt = { title: "Own it", link: commandLink(codemapCommands.ownIt, target) };
    const actions: TooltipLink[] = status.change
      ? [
        ownIt,
        { title: "Still true", link: commandLink(codemapCommands.stillTrue, target) },
        { title: "Explain again", link: commandLink(codemapCommands.explainAgain, target) },
        { title: "Explain", link: commandLink(codemapCommands.explain, target) },
      ]
      : [ownIt, { title: "Explain", link: commandLink(codemapCommands.explain, target) }];
    const markdown = codemapTooltip({
      name: path.posix.basename(entry.path),
      entry,
      status,
      startLink: entry.start !== undefined && startLocationOf(entry.start) ? commandLink(codemapCommands.openStart, target) : undefined,
      actions,
    });
    // Theme icons for the marker's $(warning); the owner's text has its "$" escaped.
    const tooltip = new vscode.MarkdownString(markdown, true);
    tooltip.isTrusted = { enabledCommands: Object.values(codemapCommands) };
    return tooltip;
  }

  private threeAmLine(): string | undefined {
    const check = this.ownership.threeAmCheck(threeAmLabelsOf[this.filter]);
    return check && describeThreeAmCheck(check);
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
