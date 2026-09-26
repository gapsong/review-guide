import * as vscode from "vscode";
import { gitAuthEnvironment } from "./git/gitAuth";
import { PullRequestCheckouts } from "./git/pullRequestCheckout";
import { findConfiguredRepos } from "./github/configuredRepos";
import { GitHubClient } from "./github/githubClient";
import { getGitHubToken } from "./github/githubLogin";
import { PullRequest } from "./github/pullRequest";
import { findUnit } from "./review/pullRequestReview";
import { ReviewGuide } from "./reviewGuide";
import { readFileSymbols } from "./ui/documentSymbols";
import { GuideView } from "./ui/guideView";
import { PullRequestTree } from "./ui/pullRequestTree";
import { showUnitDiff } from "./ui/unitDiff";

export interface ReviewGuideApi {
  reviewGuide: ReviewGuide;
  pullRequestTree: PullRequestTree;
  guideView: GuideView;
}

export function activate(context: vscode.ExtensionContext): ReviewGuideApi {
  const storagePath = context.globalStorageUri.fsPath;
  const github = new GitHubClient(githubApiUrl(), getGitHubToken);
  const checkouts = new PullRequestCheckouts(storagePath, async (cloneUrl) => gitAuthEnvironment(cloneUrl, await getGitHubToken()));
  const reviewGuide = new ReviewGuide({ checkouts, readSymbols: readFileSymbols });
  const pullRequestTree = new PullRequestTree(github, reviewGuide, findConfiguredRepos);
  const guideView = new GuideView();
  reviewGuide.onDidChangeReview(() => guideView.refresh());

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
  );
  return { reviewGuide, pullRequestTree, guideView };
}

export function deactivate(): void {
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
