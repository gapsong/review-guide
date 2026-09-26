import { Checkout } from "../git/pullRequestCheckout";
import { PullRequest, repoToString } from "../github/pullRequest";
import { ReviewUnit } from "./reviewUnit";
import { FileDiff } from "./unifiedDiff";

// Everything the extension knows about one opened pull request.
export interface PullRequestReview {
  pullRequest: PullRequest;
  checkout: Checkout;
  files: FileDiff[];
  units: ReviewUnit[];
  // What is happening right now ("Pass 1 is running"), or the last error; shown in the side bar.
  status: string | undefined;
}

export function pullRequestKey(pullRequest: PullRequest): string {
  return `${repoToString(pullRequest.repo)}#${pullRequest.number}`;
}

export function findUnit(review: PullRequestReview, unitId: string): ReviewUnit | undefined {
  return review.units.find((unit) => unit.id === unitId);
}
