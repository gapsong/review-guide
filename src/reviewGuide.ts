import { DeepCheck } from "./analysis/deepCheck";
import { runDeepCheckPass } from "./analysis/deepCheckPass";
import { runOverviewPass } from "./analysis/overviewPass";
import { RunClaude } from "./claude/claudeCli";
import { readCommitMessages, readRepoProfile, writeClaudeContext } from "./git/claudeContext";
import { PullRequestCheckouts } from "./git/pullRequestCheckout";
import { PullRequest } from "./github/pullRequest";
import { loadPullRequest, SymbolReader } from "./review/loadPullRequest";
import { findUnit, PullRequestReview, pullRequestKey, sortingOf, unitsOfTier } from "./review/pullRequestReview";
import { ReviewUnit } from "./review/reviewUnit";
import { AnalysisCache } from "./state/analysisCache";
import { ReviewStateStore, UnitRecord } from "./state/reviewState";

// Above this many critical units, pass 2 would take long and cost a lot, so the reviewer decides.
export const deepCheckLimit = 25;

export interface ReviewGuideParts {
  checkouts: PullRequestCheckouts;
  readSymbols: SymbolReader;
  cache: AnalysisCache;
  state: ReviewStateStore;
  runClaude: RunClaude;
  // Asks the reviewer whether pass 2 may start for this many critical units.
  confirmDeepCheck: (criticalUnitCount: number) => Promise<boolean>;
}

type ReviewListener = (review: PullRequestReview) => void;

// The core of the extension, free of VS Code: opens pull requests, runs the Claude passes and
// keeps the reviewer's read marks.
export class ReviewGuide {
  private readonly reviews = new Map<string, PullRequestReview>();
  private readonly deepChecksRunning = new Map<string, Promise<void>>();
  private readonly listeners: ReviewListener[] = [];

  constructor(private readonly parts: ReviewGuideParts) {}

  onDidChangeReview(listener: ReviewListener): void {
    this.listeners.push(listener);
  }

  reviewOf(pullRequest: PullRequest): PullRequestReview | undefined {
    return this.reviews.get(pullRequestKey(pullRequest));
  }

  // Loads the PR and runs pass 1. Pass 2 then runs in the background, above the limit only
  // after the reviewer agrees.
  async open(pullRequest: PullRequest): Promise<PullRequestReview> {
    const review = await this.load(pullRequest);
    this.reviews.set(pullRequestKey(pullRequest), review);
    await this.sortUnits(review);
    this.rememberUnits(review);
    this.inBackground(review, () => this.deepCheckIfAgreed(review));
    return review;
  }

  async close(pullRequest: PullRequest): Promise<void> {
    await this.deepChecksRunning.get(pullRequestKey(pullRequest));
    await this.parts.checkouts.remove(pullRequest);
    this.reviews.delete(pullRequestKey(pullRequest));
  }

  // Starts pass 2 without asking; for the "Start pass 2" command after the reviewer said no or later.
  startDeepCheck(review: PullRequestReview): void {
    this.inBackground(review, () => this.deepCheck(review));
  }

  async waitForDeepCheck(review: PullRequestReview): Promise<void> {
    await this.deepChecksRunning.get(pullRequestKey(review.pullRequest));
  }

  deepCheckOf(review: PullRequestReview, unit: ReviewUnit): DeepCheck | undefined {
    return this.parts.cache.readDeepCheck(review.pullRequest, unit.hash);
  }

  recordOf(review: PullRequestReview, unit: ReviewUnit): UnitRecord | undefined {
    return this.parts.state.recordOf(review.pullRequest.repo, review.pullRequest.number, unit.id);
  }

  setReadState(review: PullRequestReview, unitId: string, readState: "unread" | "read"): void {
    const unit = findUnit(review, unitId);
    if (unit) {
      this.parts.state.setReadState(review.pullRequest.repo, review.pullRequest.number, unit, readState);
      this.notify(review);
    }
  }

  private async load(pullRequest: PullRequest): Promise<PullRequestReview> {
    const checkout = await this.parts.checkouts.checkOut(pullRequest);
    const { files, units } = await loadPullRequest(checkout, this.parts.readSymbols);
    return {
      pullRequest,
      checkout,
      files,
      units,
      contextFolder: await writeClaudeContext(checkout, files),
      commitMessages: await readCommitMessages(checkout),
      profile: await readRepoProfile(checkout),
      overview: undefined,
      runs: [],
      status: undefined,
    };
  }

  private async sortUnits(review: PullRequestReview): Promise<void> {
    this.setStatus(review, "Pass 1 (overview) is running...");
    try {
      const { overview, run } = await runOverviewPass(review, this.parts.cache, this.parts.runClaude);
      review.overview = overview;
      review.runs.push(run);
      this.setStatus(review, undefined);
    } catch (error) {
      this.setStatus(review, `Pass 1 failed: ${messageOf(error)}`);
    }
  }

  private rememberUnits(review: PullRequestReview): void {
    const units = review.units.map((unit) => ({ unit, tier: sortingOf(review, unit)?.tier }));
    this.parts.state.updateUnits(review.pullRequest.repo, review.pullRequest.number, units);
  }

  private inBackground(review: PullRequestReview, work: () => Promise<void>): void {
    const key = pullRequestKey(review.pullRequest);
    if (!this.deepChecksRunning.has(key)) {
      const running = work().finally(() => this.deepChecksRunning.delete(key));
      this.deepChecksRunning.set(key, running);
    }
  }

  private async deepCheckIfAgreed(review: PullRequestReview): Promise<void> {
    const criticalCount = unitsOfTier(review, "critical").length;
    if (!review.overview || criticalCount === 0) {
      return;
    }
    if (criticalCount > deepCheckLimit) {
      this.setStatus(review, `Pass 2 waits for you: ${criticalCount} critical units (more than ${deepCheckLimit}).`);
      if (!(await this.parts.confirmDeepCheck(criticalCount))) {
        return;
      }
    }
    await this.deepCheck(review);
  }

  private async deepCheck(review: PullRequestReview): Promise<void> {
    const critical = unitsOfTier(review, "critical");
    this.setStatus(review, `Pass 2 (deep check) is running for ${critical.length} critical units...`);
    const { runs, failures } = await runDeepCheckPass(review, critical, this.parts.cache, this.parts.runClaude, () => this.notify(review));
    review.runs.push(...runs);
    this.setStatus(review, failures.length > 0 ? `Pass 2 failed for some units: ${failures[0]}` : undefined);
  }

  private setStatus(review: PullRequestReview, status: string | undefined): void {
    review.status = status;
    this.notify(review);
  }

  private notify(review: PullRequestReview): void {
    for (const listener of this.listeners) {
      listener(review);
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
