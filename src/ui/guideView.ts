import { randomBytes } from "crypto";
import * as vscode from "vscode";
import { PullRequestReview, sortingOf } from "../review/pullRequestReview";
import { ReviewUnit, unitTitle } from "../review/reviewUnit";
import { GuideModel, renderGuide } from "./guideHtml";

// The guide panel next to the diff: what the selected unit is, and what to check there.
export class GuideView implements vscode.WebviewViewProvider {
  static readonly viewId = "reviewGuide.guide";
  private view: vscode.WebviewView | undefined;
  private shown: { review: PullRequestReview; unit: ReviewUnit } | undefined;
  model: GuideModel | undefined;

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    this.render();
  }

  async show(review: PullRequestReview, unit: ReviewUnit): Promise<void> {
    this.shown = { review, unit };
    if (!this.view) {
      await vscode.commands.executeCommand(`${GuideView.viewId}.focus`);
    }
    this.render();
  }

  // Called when anything about the shown unit may have changed (a pass finished, a mark was set).
  refresh(): void {
    this.render();
  }

  private render(): void {
    this.model = this.shown ? guideModel(this.shown.review, this.shown.unit) : undefined;
    if (this.view) {
      this.view.webview.html = renderGuide(this.model, randomBytes(16).toString("hex"), this.view.webview.cspSource);
    }
  }

  get html(): string | undefined {
    return this.view?.webview.html;
  }
}

function guideModel(review: PullRequestReview, unit: ReviewUnit): GuideModel {
  const sorting = sortingOf(review, unit);
  return {
    tier: sorting?.tier,
    reason: sorting?.reason,
    worthHaving: sorting?.worthHaving,
    pullRequestNumber: review.pullRequest.number,
    file: unit.file,
    title: unitTitle(unit),
    lines: `lines ${unit.newRange.start}-${unit.newRange.end}`,
  };
}
