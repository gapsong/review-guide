import * as path from "path";
import * as vscode from "vscode";
import { GitHubClient } from "../github/githubClient";
import { PullRequest, RepoId, repoToString } from "../github/pullRequest";
import { Tier, tiers } from "../analysis/sorting";
import { PullRequestReview, sortingOf, unitsOfTier } from "../review/pullRequestReview";
import { ReviewUnit, unitTitle } from "../review/reviewUnit";
import { ReviewGuide } from "../reviewGuide";
import { ReadState, UnitRecord } from "../state/reviewState";

export type PullRequestTreeNode =
  | { kind: "repo"; repo: RepoId }
  | { kind: "pullRequest"; pullRequest: PullRequest }
  | { kind: "message"; text: string; tooltip?: string }
  | { kind: "summary"; review: PullRequestReview }
  | { kind: "profileDraft"; review: PullRequestReview }
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
        return messageItem(node.text, node.tooltip);
      case "summary":
        return summaryItem(node.review);
      case "profileDraft":
        return profileDraftItem(node.review);
      case "group":
        return groupItem(node.label, node.units);
      case "unit":
        return unitItem(node.review, node.unit, this.reviewGuide.recordOf(node.review, node.unit));
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
    if (!review.overview) {
      nodes.push({ kind: "group", review, label: "Changes", units: review.units });
      return nodes;
    }
    nodes.push({ kind: "summary", review });
    if (!review.profile && review.overview.draftProfile) {
      nodes.push({ kind: "profileDraft", review });
    }
    for (const tier of tiers) {
      nodes.push({ kind: "group", review, label: tierLabels[tier], units: unitsOfTier(review, tier) });
    }
    nodes.push(runsNode(review));
    return nodes;
  }
}

const tierLabels: Record<Tier, string> = { critical: "Critical", check: "Check", skim: "Skim" };

function runsNode(review: PullRequestReview): PullRequestTreeNode {
  const lines = review.runs.map((run) =>
    run.fromCache
      ? `${run.pass}: from cache, no Claude call`
      : `${run.pass}: ${Math.round(run.durationMilliseconds / 1000)} s, ${run.inputTokens} tokens in, ${run.outputTokens} tokens out`,
  );
  return { kind: "message", text: `Claude runs: ${review.runs.length}`, tooltip: lines.join("\n") };
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

function messageItem(text: string, tooltip: string | undefined): vscode.TreeItem {
  const item = new vscode.TreeItem(text);
  item.tooltip = tooltip;
  return item;
}

function summaryItem(review: PullRequestReview): vscode.TreeItem {
  const item = new vscode.TreeItem("What this PR does");
  item.description = review.overview?.summary;
  item.tooltip = review.overview?.summary;
  item.iconPath = new vscode.ThemeIcon("info");
  return item;
}

function profileDraftItem(review: PullRequestReview): vscode.TreeItem {
  const item = new vscode.TreeItem("No .review-guide.md: see Claude's draft");
  item.iconPath = new vscode.ThemeIcon("note");
  item.command = { command: "reviewGuide.showProfileDraft", title: "Show draft", arguments: [review.pullRequest] };
  return item;
}

function groupItem(label: string, units: ReviewUnit[]): vscode.TreeItem {
  return new vscode.TreeItem(`${label} (${units.length})`, vscode.TreeItemCollapsibleState.Expanded);
}

const readStateIcons: Record<ReadState, string> = { unread: "circle-large-outline", read: "eye", understood: "pass-filled" };

function unitItem(review: PullRequestReview, unit: ReviewUnit, record: UnitRecord | undefined): vscode.TreeItem {
  const item = new vscode.TreeItem(`${path.basename(unit.file)}  ${unitTitle(unit)}`);
  const readState = record?.state ?? "unread";
  item.id = `unit:${review.pullRequest.number}:${unit.id}`;
  item.iconPath = new vscode.ThemeIcon(record?.changedSinceReview ? "diff-modified" : readStateIcons[readState]);
  item.contextValue = `unit-${readState}`;
  const sorting = sortingOf(review, unit);
  item.description = sorting?.reason;
  item.tooltip = sorting ? `${unit.file}\n\n${sorting.reason}${sorting.worthHaving ? `\n\nWorth having? ${sorting.worthHaving}` : ""}` : unit.file;
  item.command = { command: "reviewGuide.openUnit", title: "Open", arguments: [review.pullRequest, unit.id] };
  return item;
}
