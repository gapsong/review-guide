import * as vscode from "vscode";
import { findConfiguredRepos } from "./github/configuredRepos";
import { GitHubClient } from "./github/githubClient";
import { getGitHubToken } from "./github/githubLogin";
import { PullRequestTree } from "./ui/pullRequestTree";

export interface ReviewGuideApi {
  pullRequestTree: PullRequestTree;
}

export function activate(context: vscode.ExtensionContext): ReviewGuideApi {
  const github = new GitHubClient(githubApiUrl(), getGitHubToken);
  const pullRequestTree = new PullRequestTree(github, findConfiguredRepos);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("reviewGuide.pullRequests", pullRequestTree),
    vscode.commands.registerCommand("reviewGuide.refresh", () => pullRequestTree.refresh()),
  );
  return { pullRequestTree };
}

export function deactivate(): void {
}

function githubApiUrl(): string {
  return vscode.workspace.getConfiguration("reviewGuide").get<string>("githubApiUrl", "https://api.github.com");
}
