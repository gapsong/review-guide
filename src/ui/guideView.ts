import { randomBytes } from "crypto";
import * as vscode from "vscode";
import { PullRequestReview, sortingOf } from "../review/pullRequestReview";
import { ReviewUnit, unitTitle } from "../review/reviewUnit";
import { ReviewGuide } from "../reviewGuide";
import { GuideMessage, GuideModel, renderGuide } from "./guideHtml";

export type GuideMessageHandler = (review: PullRequestReview, unit: ReviewUnit, message: GuideMessage) => Promise<void>;

// The guide panel next to the diff: what the selected unit is, and what to check there.
export class GuideView implements vscode.WebviewViewProvider {
  static readonly viewId = "reviewGuide.guide";
  private view: vscode.WebviewView | undefined;
  private shown: { review: PullRequestReview; unit: ReviewUnit } | undefined;
  private checkingExplanation = false;
  private readonly drafts = new Map<string, string>();
  model: GuideModel | undefined;

  constructor(
    private readonly reviewGuide: ReviewGuide,
    private readonly handleMessage: GuideMessageHandler,
  ) {
    reviewGuide.onDidChangeReview(() => this.render());
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.onDidReceiveMessage((message: GuideMessage) => this.receive(message));
    this.render();
  }

  async show(review: PullRequestReview, unit: ReviewUnit): Promise<void> {
    this.shown = { review, unit };
    if (!this.view) {
      await vscode.commands.executeCommand(`${GuideView.viewId}.focus`);
    }
    this.render();
  }

  // What the panel's buttons and links send. Public so tests can press them.
  async receive(message: GuideMessage): Promise<void> {
    if (!this.shown) {
      return;
    }
    const { review, unit } = this.shown;
    if (message.type === "draft") {
      this.drafts.set(draftKey(review, unit), message.text);
      return;
    }
    if (message.type !== "explain") {
      await this.handleMessage(review, unit, message);
      return;
    }
    this.checkingExplanation = true;
    this.render();
    try {
      await this.handleMessage(review, unit, message);
      this.drafts.delete(draftKey(review, unit));
    } finally {
      this.checkingExplanation = false;
      this.render();
    }
  }

  get html(): string | undefined {
    return this.view?.webview.html;
  }

  private render(): void {
    this.model = this.shown ? this.modelOf(this.shown.review, this.shown.unit) : undefined;
    if (this.view) {
      this.view.webview.html = renderGuide(this.model, randomBytes(16).toString("hex"), this.view.webview.cspSource);
    }
  }

  private modelOf(review: PullRequestReview, unit: ReviewUnit): GuideModel {
    const sorting = sortingOf(review, unit);
    const record = this.reviewGuide.recordOf(review, unit);
    return {
      pullRequestNumber: review.pullRequest.number,
      file: unit.file,
      title: unitTitle(unit),
      lines: `lines ${unit.newRange.start}-${unit.newRange.end}`,
      tier: sorting?.tier,
      reason: sorting?.reason,
      worthHaving: sorting?.worthHaving,
      readState: record?.state ?? "unread",
      changedSinceReview: record?.changedSinceReview ?? false,
      deepCheck: this.reviewGuide.deepCheckOf(review, unit),
      explanation: record?.explanation,
      draft: this.drafts.get(draftKey(review, unit)),
      lastCheck: record?.lastCheck,
      checkingExplanation: this.checkingExplanation,
    };
  }
}

function draftKey(review: PullRequestReview, unit: ReviewUnit): string {
  return `${review.pullRequest.number}:${unit.id}`;
}
