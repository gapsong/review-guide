import * as path from "path";
import * as vscode from "vscode";
import { GitHubClient } from "../github/githubClient";
import { PullRequest, RepoId, repoToString } from "../github/pullRequest";
import { PullRequestReview } from "../review/pullRequestReview";
import { ReviewUnit, unitTitle } from "../review/reviewUnit";
import { ReviewGuide } from "../reviewGuide";

export type PullRequestTreeNode =
  | { kind: "repo"; repo: RepoId }
  | { kind: "pullRequest"; pullRequest: PullRequest }
  | { kind: "message"; text: string }
  | { kind: "group"; review: PullRequestReview; label: string; units: ReviewUnit[] }
  | { kind: "unit"; review: PullRequestReview; unit: ReviewUnit };

export class PullRequestTree implements vscode.TreeDataProvider<PullRequestTreeNode> {
  private readonly changed = new vscode.EventEmitter<PullRequestTreeNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(
    private readonly github: GitHubClient,
    private readonly reviewGuide: ReviewGuide,
    private readonly findRepos: () => Promise<RepoId[]>,
  ) {
    reviewGuide.onDidChangeReview(() => this.refresh());
  }

  refresh(): void {
    this.changed.fire(undefined);
  }

  async getChildren(node?: PullRequestTreeNode): Promise<PullRequestTreeNode[]> {
    if (!node) {
      return this.repoNodes();
    }
    switch (node.kind) {
      case "repo":
        return this.pullRequestNodes(node.repo);
      case "pullRequest":
        return this.reviewNodes(node.pullRequest);
      case "group":
        return node.units.map((unit) => ({ kind: "unit", review: node.review, unit }));
      default:
        return [];
    }
  }

  getTreeItem(node: PullRequestTreeNode): vscode.TreeItem {
    switch (node.kind) {
      case "repo":
        return repoItem(node.repo);
      case "pullRequest":
        return pullRequestItem(node.pullRequest, this.reviewGuide.reviewOf(node.pullRequest));
      case "message":
        return new vscode.TreeItem(node.text);
      case "group":
        return groupItem(node.label, node.units);
      case "unit":
        return unitItem(node.review, node.unit);
    }
  }

  private async repoNodes(): Promise<PullRequestTreeNode[]> {
    const repos = await this.findRepos();
    if (repos.length === 0) {
      return [{ kind: "message", text: "No repository: set reviewGuide.repositories or open a GitHub repo" }];
    }
    return repos.map((repo) => ({ kind: "repo", repo }));
  }

  private async pullRequestNodes(repo: RepoId): Promise<PullRequestTreeNode[]> {
    try {
      const pullRequests = await this.github.listOpenPullRequests(repo);
      if (pullRequests.length === 0) {
        return [{ kind: "message", text: "No open pull requests" }];
      }
      return pullRequests.map((pullRequest) => ({ kind: "pullRequest", pullRequest }));
    } catch (error) {
      return [{ kind: "message", text: `Could not list pull requests: ${String(error)}` }];
    }
  }

  private reviewNodes(pullRequest: PullRequest): PullRequestTreeNode[] {
    const review = this.reviewGuide.reviewOf(pullRequest);
    if (!review) {
      return [];
    }
    const nodes: PullRequestTreeNode[] = [];
    if (review.status) {
      nodes.push({ kind: "message", text: review.status });
    }
    nodes.push({ kind: "group", review, label: "Changes", units: review.units });
    return nodes;
  }
}

function repoItem(repo: RepoId): vscode.TreeItem {
  const item = new vscode.TreeItem(repoToString(repo), vscode.TreeItemCollapsibleState.Expanded);
  item.iconPath = new vscode.ThemeIcon("repo");
  return item;
}

function pullRequestItem(pullRequest: PullRequest, review: PullRequestReview | undefined): vscode.TreeItem {
  const collapsible = review ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None;
  const item = new vscode.TreeItem(`PR #${pullRequest.number}  ${pullRequest.title}`, collapsible);
  item.id = `pr:${repoToString(pullRequest.repo)}#${pullRequest.number}:${review ? "open" : "closed"}`;
  item.description = `${pullRequest.headRef} -> ${pullRequest.baseRef}`;
  item.tooltip = `${pullRequest.title}\nby ${pullRequest.author}`;
  item.iconPath = new vscode.ThemeIcon("git-pull-request");
  item.contextValue = review ? "openPullRequest" : "pullRequest";
  if (!review) {
    item.command = { command: "reviewGuide.openPullRequest", title: "Open", arguments: [pullRequest] };
  }
  return item;
}

function groupItem(label: string, units: ReviewUnit[]): vscode.TreeItem {
  return new vscode.TreeItem(`${label} (${units.length})`, vscode.TreeItemCollapsibleState.Expanded);
}

function unitItem(review: PullRequestReview, unit: ReviewUnit): vscode.TreeItem {
  const item = new vscode.TreeItem(`${path.basename(unit.file)}  ${unitTitle(unit)}`);
  item.tooltip = unit.file;
  item.command = { command: "reviewGuide.openUnit", title: "Open", arguments: [review.pullRequest, unit.id] };
  return item;
}
