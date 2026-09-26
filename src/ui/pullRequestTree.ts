import * as vscode from "vscode";
import { GitHubClient } from "../github/githubClient";
import { PullRequest, RepoId, repoToString } from "../github/pullRequest";

export type PullRequestTreeNode =
  | { kind: "repo"; repo: RepoId }
  | { kind: "pullRequest"; pullRequest: PullRequest }
  | { kind: "message"; text: string };

export class PullRequestTree implements vscode.TreeDataProvider<PullRequestTreeNode> {
  private readonly changed = new vscode.EventEmitter<PullRequestTreeNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(
    private readonly github: GitHubClient,
    private readonly findRepos: () => Promise<RepoId[]>,
  ) {}

  refresh(): void {
    this.changed.fire(undefined);
  }

  async getChildren(node?: PullRequestTreeNode): Promise<PullRequestTreeNode[]> {
    if (!node) {
      return this.repoNodes();
    }
    if (node.kind === "repo") {
      return this.pullRequestNodes(node.repo);
    }
    return [];
  }

  getTreeItem(node: PullRequestTreeNode): vscode.TreeItem {
    switch (node.kind) {
      case "repo":
        return repoItem(node.repo);
      case "pullRequest":
        return pullRequestItem(node.pullRequest);
      case "message":
        return new vscode.TreeItem(node.text);
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
}

function repoItem(repo: RepoId): vscode.TreeItem {
  const item = new vscode.TreeItem(repoToString(repo), vscode.TreeItemCollapsibleState.Expanded);
  item.iconPath = new vscode.ThemeIcon("repo");
  return item;
}

function pullRequestItem(pullRequest: PullRequest): vscode.TreeItem {
  const item = new vscode.TreeItem(`PR #${pullRequest.number}  ${pullRequest.title}`);
  item.description = `${pullRequest.headRef} -> ${pullRequest.baseRef}`;
  item.tooltip = `${pullRequest.title}\nby ${pullRequest.author}`;
  item.iconPath = new vscode.ThemeIcon("git-pull-request");
  item.contextValue = "pullRequest";
  return item;
}
