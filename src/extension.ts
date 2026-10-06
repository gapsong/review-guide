import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { claudeRunner, ClaudeSettings } from "./claude/claudeCli";
import { defaultExplanationLanguage, ExplainRequest, explainTerminal } from "./claude/explainPrompt";
import { WorkspaceCodemaps } from "./codemap/workspaceCodemaps";
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
import { CodemapDecorations } from "./ui/codemapDecorations";
import { readFileSymbols } from "./ui/documentSymbols";
import { ExplainPanels } from "./ui/explainPanel";
import { GuideMessage } from "./ui/guideHtml";
import { GuideView } from "./ui/guideView";
import { OwnershipTree } from "./ui/ownershipTree";
import { PullRequestTree } from "./ui/pullRequestTree";
import { revealLines, showUnitDiff } from "./ui/unitDiff";

export interface ReviewGuideApi {
  reviewGuide: ReviewGuide;
  pullRequestTree: PullRequestTree;
  guideView: GuideView;
  ownershipTree: OwnershipTree;
  codemaps: WorkspaceCodemaps;
  codemapDecorations: CodemapDecorations;
  explainPanels: ExplainPanels;
}

export function activate(context: vscode.ExtensionContext): ReviewGuideApi {
  const storagePath = context.globalStorageUri.fsPath;
  const github = new GitHubClient(githubApiUrl, getGitHubToken);
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
  const guideView = new GuideView(reviewGuide, (review, unit, message) =>
    handleGuideMessage(reviewGuide, review, unit, message).catch(showError),
  );
  const ownershipTree = new OwnershipTree(reviewGuide, findConfiguredRepos);
  const codemaps = new WorkspaceCodemaps(codemapFile);
  const codemapDecorations = new CodemapDecorations(codemaps);
  const explainPanels = new ExplainPanels(codemaps, (folder, request) => startExplainTerminal(context, folder, request), showError);

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
    codemaps,
    explainPanels,
    vscode.window.registerFileDecorationProvider(codemapDecorations),
    vscode.window.registerTreeDataProvider("reviewGuide.pullRequests", pullRequestTree),
    vscode.window.registerWebviewViewProvider(GuideView.viewId, guideView, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.window.registerTreeDataProvider("reviewGuide.ownership", ownershipTree),
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
    // From the Explorer's context menu VS Code passes the clicked file or folder; from the command
    // palette nothing, so the active editor's file is explained.
    vscode.commands.registerCommand("reviewGuide.explainPath", reportErrors(async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) {
        throw new Error("Open a file, or right-click a file or folder in the Explorer, to explain it.");
      }
      await explainPanels.show(target);
    })),
  );
  return { reviewGuide, pullRequestTree, guideView, ownershipTree, codemaps, codemapDecorations, explainPanels };
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
    case "draft":
      return;
    case "explain":
      if (message.text.trim() !== "") {
        await reviewGuide.sendOwnershipMessage(review, unit.id, message.text);
      }
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

// Unlike the read-only review runs, this run may run the app and write files, so it runs visibly in a
// terminal, under Claude Code's normal permission prompts, and only after the owner pressed the button
// (DECISIONS.md). Claude Code is the terminal's process, not a shell, so no file name can become a command.
function startExplainTerminal(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder, request: ExplainRequest): void {
  const template = fs.readFileSync(path.join(context.extensionPath, "media", "explainPrompt.md"), "utf8");
  const command = explainTerminal({ claudePath: claudeSettings().executable, language: explanationLanguage() }, template, request);
  const terminal = vscode.window.createTerminal({ name: command.name, cwd: folder.uri, shellPath: command.executable, shellArgs: command.args });
  terminal.show();
}

// The extension never writes into a repo; the reviewer saves the profile there themselves.
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

function explanationLanguage(): string {
  return vscode.workspace.getConfiguration("reviewGuide").get<string>("explanationLanguage", defaultExplanationLanguage);
}

function codemapFile(): string {
  return vscode.workspace.getConfiguration("reviewGuide").get<string>("codemapFile", ".codemap/codemap.yaml");
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
      showError(error);
      throw error;
    }
  };
}

function showError(error: unknown): void {
  void vscode.window.showErrorMessage(`Review Guide: ${error instanceof Error ? error.message : String(error)}`);
}
