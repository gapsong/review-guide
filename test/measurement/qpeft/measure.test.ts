import * as assert from "assert";
import * as fs from "fs";
import * as vscode from "vscode";
import type { ReviewGuideApi } from "../../../src/extension";
import { unitsOfTier, sortingOf, PullRequestReview } from "../../../src/review/pullRequestReview";
import { unitTitle } from "../../../src/review/reviewUnit";
import * as claudeContext from "../../../src/git/claudeContext";
import { StandInGitHubLogin } from "../../integration/standInGitHubLogin";

// The manual quality check Q1-Q3 of SPEC.md: one real run (real GitHub, real Claude Opus) on the
// fixed test PR gapsong/qpeft #8 at 4369298. Not part of `npm test`; run with `node scripts/measure-qpeft.js`.
const expectedHead = "43692980963628ae56dc0c94955a0bde5261e56e";

describe("Q1-Q3 measurement on gapsong/qpeft PR #8", function () {
  this.timeout(60 * 60 * 1000);

  it("opens the PR, runs pass 1 and records every unit's tier", async () => {
    useProfileFromFile(process.env.REVIEW_GUIDE_MEASURE_PROFILE);
    vscode.authentication.registerAuthenticationProvider("github", "GitHub", new StandInGitHubLogin(process.env.REVIEW_GUIDE_GITHUB_TOKEN!));
    const settings = vscode.workspace.getConfiguration("reviewGuide");
    await settings.update("repositories", ["gapsong/qpeft"], vscode.ConfigurationTarget.Global);
    await settings.update("claudePath", process.env.REVIEW_GUIDE_CLAUDE, vscode.ConfigurationTarget.Global);
    const api = await vscode.extensions.getExtension<ReviewGuideApi>("gapsong.review-guide")!.activate();

    const [repo] = await api.pullRequestTree.getChildren();
    const pullRequests = await api.pullRequestTree.getChildren(repo);
    const node = pullRequests.find((candidate) => candidate.kind === "pullRequest" && candidate.pullRequest.number === 8);
    assert.ok(node && node.kind === "pullRequest", "PR #8 is listed");
    assert.strictEqual(node.pullRequest.headSha, expectedHead, "develop is still at the fixed commit");

    const openedAt = Date.now();
    const review = await api.reviewGuide.open(node.pullRequest);
    const overviewAt = Date.now();
    assert.ok(review.overview, `pass 1 finished: ${review.status}`);

    // Pass 2 is not part of Q1-Q3. Above the limit it would wait for a click that never comes here.
    const onlyPassOne = process.env.REVIEW_GUIDE_MEASURE_PASS_ONE_ONLY === "1";
    if (!onlyPassOne && !review.status?.startsWith("Pass 2 waits")) {
      await api.reviewGuide.waitForDeepCheck(review);
    }
    const deepCheckedAt = Date.now();
    fs.writeFileSync(process.env.REVIEW_GUIDE_MEASUREMENT_OUT!, JSON.stringify(measurement(api, review, openedAt, overviewAt, deepCheckedAt), null, 2));
  });
});

// qpeft has no .review-guide.md yet. To measure what the profile the reviewer would write changes, the
// measurement can give one from a file instead of the one on the base branch.
function useProfileFromFile(profilePath: string | undefined): void {
  if (profilePath) {
    const profile = fs.readFileSync(profilePath, "utf8");
    (claudeContext as { readRepoProfile: typeof claudeContext.readRepoProfile }).readRepoProfile = async () => profile;
  }
}

function measurement(api: ReviewGuideApi, review: PullRequestReview, openedAt: number, overviewAt: number, deepCheckedAt: number) {
  return {
    headSha: review.checkout.headSha,
    mergeBaseSha: review.checkout.mergeBaseSha,
    secondsToOverview: (overviewAt - openedAt) / 1000,
    secondsToDeepCheckDone: (deepCheckedAt - openedAt) / 1000,
    status: review.status,
    profile: review.profile,
    runs: review.runs,
    summary: review.overview?.summary,
    draftProfile: review.overview?.draftProfile,
    criticalCount: unitsOfTier(review, "critical").length,
    units: review.units.map((unit) => ({
      file: unit.file,
      kind: unit.kind,
      symbolPath: unit.symbolPath,
      title: unitTitle(unit),
      newRange: unit.newRange,
      tier: sortingOf(review, unit)?.tier,
      reason: sortingOf(review, unit)?.reason,
      worthHaving: sortingOf(review, unit)?.worthHaving,
      deepCheck: api.reviewGuide.deepCheckOf(review, unit),
    })),
  };
}
