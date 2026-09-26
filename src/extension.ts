import * as path from "path";
import * as vscode from "vscode";
import { claudeRunner, ClaudeSettings } from "./claude/claudeCli";
import { gitAuthEnvironment } from "./git/gitAuth";
import { PullRequestCheckouts } from "./git/pullRequestCheckout";
import { findConfiguredRepos } from "./github/configuredRepos";
import { GitHubClient } from "./github/githubClient";
import { getGitHubToken } from "./github/githubLogin";
import { PullRequest } from "./github/pullRequest";
import { findUnit, PullRequestReview } from "./review/pullRequestReview";
import { ReviewUnit } from "./review/reviewUnit";
import { deepCheckLimit, ReviewGuide } from "./reviewGuide";
import { AnalysisCache } from "./state/analysisCache";
import { ReviewStateStore } from "./state/reviewState";
import { readFileSymbols } from "./ui/documentSymbols";
import { GuideMessage } from "./ui/guideHtml";
import { GuideView } from "./ui/guideView";
import { PullRequestTree } from "./ui/pullRequestTree";
import { revealLines, showUnitDiff } from "./ui/unitDiff";

export interface ReviewGuideApi {
  reviewGuide: ReviewGuide;
  pullRequestTree: PullRequestTree;
  guideView: GuideView;
}

export function activate(context: vscode.ExtensionContext): ReviewGuideApi {
  const storagePath = context.globalStorageUri.fsPath;
  const github = new GitHubClient(githubApiUrl(), getGitHubToken);
  const checkouts = new PullRequestCheckouts(storagePath, async (cloneUrl) => gitAuthEnvironment(cloneUrl, await getGitHubToken()));
  const reviewGuide = new ReviewGuide({
    checkouts,
    readSymbols: readFileSymbols,
    cache: new AnalysisCache(path.join(storagePath, "cache")),
    state: new ReviewStateStore(path.join(storagePath, "state")),
    runClaude: claudeRunner(claudeSettings),
    confirmDeepCheck: askToStartDeepCheck,
  });
  const pullRequestTree = new PullRequestTree(github, reviewGuide, findConfiguredRepos);
  const guideView = new GuideView(reviewGuide, (review, unit, message) => handleGuideMessage(reviewGuide, review, unit, message));

  const openPullRequest = async (pullRequest: PullRequest) => {
    await vscode.window.withProgress(
      { location: { viewId: "reviewGuide.pullRequests" }, title: `Opening PR #${pullRequest.number}` },
      () => reviewGuide.open(pullRequest),
    );
  };
  const openUnit = async (pullRequest: PullRequest, unitId: string) => {
    const review = reviewGuide.reviewOf(pullRequest);
    const unit = review && findUnit(review, unitId);
    if (review && unit) {
      await guideView.show(review, unit);
      await showUnitDiff(review, unit);
    }
  };

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("reviewGuide.pullRequests", pullRequestTree),
    vscode.window.registerWebviewViewProvider(GuideView.viewId, guideView),
    vscode.commands.registerCommand("reviewGuide.refresh", () => pullRequestTree.refresh()),
    vscode.commands.registerCommand("reviewGuide.openPullRequest", reportErrors(openPullRequest)),
    vscode.commands.registerCommand("reviewGuide.closePullRequest", reportErrors(async (node: { pullRequest: PullRequest }) => {
      await reviewGuide.close(node.pullRequest);
      pullRequestTree.refresh();
    })),
    vscode.commands.registerCommand("reviewGuide.openUnit", reportErrors(openUnit)),
    vscode.commands.registerCommand("reviewGuide.startDeepCheck", reportErrors(async (node: { pullRequest: PullRequest }) => {
      const review = reviewGuide.reviewOf(node.pullRequest);
      if (review) {
        reviewGuide.startDeepCheck(review);
      }
    })),
    vscode.commands.registerCommand("reviewGuide.markRead", reportErrors(async (node: { review: PullRequestReview; unit: ReviewUnit }) => {
      reviewGuide.setReadState(node.review, node.unit.id, "read");
    })),
    vscode.commands.registerCommand("reviewGuide.markUnread", reportErrors(async (node: { review: PullRequestReview; unit: ReviewUnit }) => {
      reviewGuide.setReadState(node.review, node.unit.id, "unread");
    })),
    vscode.commands.registerCommand("reviewGuide.showProfileDraft", reportErrors(async (pullRequest: PullRequest) => {
      const draft = reviewGuide.reviewOf(pullRequest)?.overview?.draftProfile ?? "";
      const document = await vscode.workspace.openTextDocument({ language: "markdown", content: draftProfileText(draft) });
      await vscode.window.showTextDocument(document);
    })),
  );
  return { reviewGuide, pullRequestTree, guideView };
}

export function deactivate(): void {
}

async function handleGuideMessage(reviewGuide: ReviewGuide, review: PullRequestReview, unit: ReviewUnit, message: GuideMessage): Promise<void> {
  switch (message.type) {
    case "markRead":
      reviewGuide.setReadState(review, unit.id, "read");
      return;
    case "markUnread":
      reviewGuide.setReadState(review, unit.id, "unread");
      return;
    case "reveal":
      await revealLines(review, unit, message.start, message.end);
      return;
  }
}

async function askToStartDeepCheck(criticalUnitCount: number): Promise<boolean> {
  const start = "Start pass 2";
  const answer = await vscode.window.showWarningMessage(
    `Review Guide: this PR has ${criticalUnitCount} critical units (more than ${deepCheckLimit}). Pass 2 checks each of them with Claude, which takes a while and uses your Claude quota. Start pass 2?`,
    start,
    "Not now",
  );
  return answer === start;
}

// The extension never writes into a repo; the reviewer saves the profile there himself.
function draftProfileText(draft: string): string {
  return `<!-- Draft of .review-guide.md written by Claude. Edit it, then save it as .review-guide.md in the repo root. -->\n\n${draft}\n`;
}

function claudeSettings(): ClaudeSettings {
  const settings = vscode.workspace.getConfiguration("reviewGuide");
  return {
    executable: settings.get<string>("claudePath", "claude"),
    model: settings.get<string>("model", "claude-opus-5-5"),
  };
}

function githubApiUrl(): string {
  return vscode.workspace.getConfiguration("reviewGuide").get<string>("githubApiUrl", "https://api.github.com");
}

// Commands run from clicks; an error there should reach the user, not vanish in a log.
function reportErrors<Args extends unknown[]>(command: (...args: Args) => Promise<void>): (...args: Args) => Promise<void> {
  return async (...args: Args) => {
    try {
      await command(...args);
    } catch (error) {
      void vscode.window.showErrorMessage(`Review Guide: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  };
}
