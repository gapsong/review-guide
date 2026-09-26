import { finalSorting } from "../analysis/finalSorting";
import { RunRecord, Tier, UnitSorting } from "../analysis/sorting";
import { Checkout } from "../git/pullRequestCheckout";
import { PullRequest, repoToString } from "../github/pullRequest";
import { CachedOverview } from "../state/analysisCache";
import { ReviewUnit } from "./reviewUnit";
import { FileDiff } from "./unifiedDiff";

// Everything the extension knows about one opened pull request.
export interface PullRequestReview {
  pullRequest: PullRequest;
  checkout: Checkout;
  files: FileDiff[];
  units: ReviewUnit[];
  // The folder with git output that Claude may read.
  contextFolder: string;
  commitMessages: string;
  // The repo's .review-guide.md on the base branch, if there is one.
  profile: string | undefined;
  // Pass 1's result, once it is there.
  overview: CachedOverview | undefined;
  runs: RunRecord[];
  // What is happening right now ("Pass 1 is running"), or the last error; shown in the side bar.
  status: string | undefined;
}

export function pullRequestKey(pullRequest: PullRequest): string {
  return `${repoToString(pullRequest.repo)}#${pullRequest.number}`;
}

export function findUnit(review: PullRequestReview, unitId: string): ReviewUnit | undefined {
  return review.units.find((unit) => unit.id === unitId);
}

export function sortingOf(review: PullRequestReview, unit: ReviewUnit): UnitSorting | undefined {
  if (!review.overview) {
    return undefined;
  }
  return finalSorting(unit, review.overview.sortingsByHash[unit.hash]);
}

// The units of one tier, in Claude's reading order (units it did not order come last).
export function unitsOfTier(review: PullRequestReview, tier: Tier): ReviewUnit[] {
  const units = review.units.filter((unit) => sortingOf(review, unit)?.tier === tier);
  const order = review.overview?.readingOrder ?? [];
  const position = (unit: ReviewUnit) => {
    const index = order.indexOf(unit.id);
    return index === -1 ? order.length : index;
  };
  return units.sort((a, b) => position(a) - position(b));
}
