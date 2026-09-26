import * as vscode from "vscode";
import { RepoId, repoToString } from "../github/pullRequest";
import { ReviewGuide } from "../reviewGuide";
import { FileOwnership } from "../state/ownership";

export type OwnershipTreeNode =
  | { kind: "repo"; repo: RepoId }
  | { kind: "file"; ownership: FileOwnership }
  | { kind: "message"; text: string };

// Which parts of each repo the reviewer owns: per file, critical units understood out of all critical units.
export class OwnershipTree implements vscode.TreeDataProvider<OwnershipTreeNode> {
  private readonly changed = new vscode.EventEmitter<OwnershipTreeNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(
    private readonly reviewGuide: ReviewGuide,
    private readonly findRepos: () => Promise<RepoId[]>,
  ) {
    reviewGuide.onDidChangeReview(() => this.changed.fire(undefined));
  }

  async getChildren(node?: OwnershipTreeNode): Promise<OwnershipTreeNode[]> {
    if (!node) {
      return (await this.findRepos()).map((repo) => ({ kind: "repo", repo }));
    }
    if (node.kind !== "repo") {
      return [];
    }
    const files = this.reviewGuide.ownershipOf(node.repo);
    if (files.length === 0) {
      return [{ kind: "message", text: "No critical units reviewed yet" }];
    }
    return files.map((ownership) => ({ kind: "file", ownership }));
  }

  getTreeItem(node: OwnershipTreeNode): vscode.TreeItem {
    switch (node.kind) {
      case "repo": {
        const item = new vscode.TreeItem(repoToString(node.repo), vscode.TreeItemCollapsibleState.Expanded);
        item.iconPath = new vscode.ThemeIcon("repo");
        return item;
      }
      case "file":
        return fileItem(node.ownership);
      case "message":
        return new vscode.TreeItem(node.text);
    }
  }
}

function fileItem({ file, understood, critical }: FileOwnership): vscode.TreeItem {
  const item = new vscode.TreeItem(`${file} ${understood}/${critical}`);
  item.tooltip = `${understood} of ${critical} critical units in ${file} understood, across all reviewed PRs`;
  item.iconPath = new vscode.ThemeIcon(understood === critical ? "pass-filled" : understood === 0 ? "circle-large-outline" : "circle-large-filled");
  return item;
}
