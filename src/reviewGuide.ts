import { PullRequestCheckouts } from "./git/pullRequestCheckout";
import { PullRequest } from "./github/pullRequest";
import { loadPullRequest, SymbolReader } from "./review/loadPullRequest";
import { PullRequestReview, pullRequestKey } from "./review/pullRequestReview";

export interface ReviewGuideParts {
  checkouts: PullRequestCheckouts;
  readSymbols: SymbolReader;
}

type ReviewListener = (review: PullRequestReview) => void;

// The core of the extension, free of VS Code: opens pull requests and keeps their reviews.
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
    const checkout = await this.parts.checkouts.checkOut(pullRequest);
    const { files, units } = await loadPullRequest(checkout, this.parts.readSymbols);
    const review: PullRequestReview = { pullRequest, checkout, files, units, status: undefined };
    this.reviews.set(pullRequestKey(pullRequest), review);
    this.notify(review);
    return review;
  }

  async close(pullRequest: PullRequest): Promise<void> {
    await this.parts.checkouts.remove(pullRequest);
    this.reviews.delete(pullRequestKey(pullRequest));
  }

  private notify(review: PullRequestReview): void {
    for (const listener of this.listeners) {
      listener(review);
    }
  }
}
