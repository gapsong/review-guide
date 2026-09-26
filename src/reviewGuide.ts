import { runOverviewPass } from "./analysis/overviewPass";
import { RunClaude } from "./claude/claudeCli";
import { readCommitMessages, readRepoProfile, writeClaudeContext } from "./git/claudeContext";
import { PullRequestCheckouts } from "./git/pullRequestCheckout";
import { PullRequest } from "./github/pullRequest";
import { loadPullRequest, SymbolReader } from "./review/loadPullRequest";
import { PullRequestReview, pullRequestKey } from "./review/pullRequestReview";
import { AnalysisCache } from "./state/analysisCache";

export interface ReviewGuideParts {
  checkouts: PullRequestCheckouts;
  readSymbols: SymbolReader;
  cache: AnalysisCache;
  runClaude: RunClaude;
}

type ReviewListener = (review: PullRequestReview) => void;

// The core of the extension, free of VS Code: opens pull requests and runs the Claude passes.
export class ReviewGuide {
  private readonly reviews = new Map<string, PullRequestReview>();
  private readonly listeners: ReviewListener[] = [];

  constructor(private readonly parts: ReviewGuideParts) {}

  onDidChangeReview(listener: ReviewListener): void {
    this.listeners.push(listener);
  }

  reviewOf(pullRequest: PullRequest): PullRequestReview | undefined {
    return this.reviews.get(pullRequestKey(pullRequest));
  }

  async open(pullRequest: PullRequest): Promise<PullRequestReview> {
    const review = await this.load(pullRequest);
    this.reviews.set(pullRequestKey(pullRequest), review);
    await this.sortUnits(review);
    return review;
  }

  async close(pullRequest: PullRequest): Promise<void> {
    await this.parts.checkouts.remove(pullRequest);
    this.reviews.delete(pullRequestKey(pullRequest));
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
