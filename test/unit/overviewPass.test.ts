import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { PullRequestReview, sortingOf } from "../../src/review/pullRequestReview";
import { unitTitle } from "../../src/review/reviewUnit";
import { createFixtureRemote, FixtureRemote, makeTempDir, pullRequestOf, pushNewHead } from "../support/gitFixture";
import { pythonBase, pythonHead } from "../support/pythonFixture";
import { testReviewGuide, useFakeClaude } from "../support/testReviewGuide";

describe("pass 1: sorting the units of a PR", () => {
  let scratch: string;
  let remote: FixtureRemote;

  beforeEach(() => {
    scratch = makeTempDir("overview");
    remote = createFixtureRemote(scratch, pythonBase, pythonHead, 8);
  });

  afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  // Opens the PR and waits for pass 2, which runs in the background.
  async function openAndWait(storage: string): Promise<PullRequestReview> {
    const guide = testReviewGuide(storage);
    const review = await guide.open(pullRequestOf(remote.pull));
    await guide.waitForDeepCheck(review);
    return review;
  }

  function titlesByTier(review: PullRequestReview): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const unit of review.units) {
      const tier = sortingOf(review, unit)!.tier;
      result[tier] = [...(result[tier] ?? []), `${unit.file}: ${unitTitle(unit)}`];
    }
    return result;
  }

  it("F3: gives every review unit a tier and one sentence why", async () => {
    useFakeClaude(scratch, { "pack_codes": "critical", "trainer.py": "check" });
    const review = await openAndWait(path.join(scratch, "storage"));

    assert.ok(review.units.length >= 6);
    for (const unit of review.units) {
      const sorting = sortingOf(review, unit);
      assert.ok(sorting, `${unit.id} has a sorting`);
      assert.ok(["critical", "check", "skim"].includes(sorting.tier), `${unit.id} has a tier`);
      assert.match(sorting.reason, /^[A-Z].*\.$/, `${unit.id} has a one-sentence reason`);
    }
    assert.strictEqual(sortingOf(review, review.units.find((unit) => unit.symbolPath === "pack_codes")!)!.tier, "critical");
    assert.strictEqual(sortingOf(review, review.units.find((unit) => unit.symbolPath === "Trainer.learning_rate")!)!.tier, "check");
    assert.strictEqual(review.overview!.summary, "Fake summary of the pull request.");
  });

  it("F13: a test change that removes an assertion, loosens a tolerance or adds a skip is critical", async () => {
    // Claude says "skim" for every test here; the rule must win anyway.
    useFakeClaude(scratch, { "tests/": "skim" });
    const review = await openAndWait(path.join(scratch, "storage"));

    const testUnits = review.units.filter((unit) => unit.isTestFile);
    const reasons = testUnits.map((unit) => [unitTitle(unit), sortingOf(review, unit)!.tier, sortingOf(review, unit)!.reason]);
    assert.deepStrictEqual(reasons, [
      ["test_round_trip()", "critical", "Weakened test: removes an assertion (`assert unpack_codes(pack_codes(codes, 3), 3) == codes`)."],
      ["test_scale()", "critical", "Weakened test: loosens the tolerance atol from 0.000001 to 0.01."],
      ["(outside functions)", "critical", "Weakened test: adds a skip (`@pytest.mark.skip(reason=\"kernel not built on CI\")`)."],
    ]);
  });

  it("runs Claude in the PR worktree, with the git context folder next to it", async () => {
    const fakeClaude = useFakeClaude(scratch, {});
    const review = await openAndWait(path.join(scratch, "storage"));

    assert.strictEqual(fakeClaude.calls()[0].cwd, review.checkout.worktreePath);
    const context = fs.readdirSync(review.contextFolder).sort();
    assert.deepStrictEqual(context, ["changes.diff", "history.txt", "pull-request.md"]);
  });

  it("F7: a second run on the same head commit does not call Claude again", async () => {
    const fakeClaude = useFakeClaude(scratch, { "pack_codes": "critical" });
    const storage = path.join(scratch, "storage");
    const firstGuide = testReviewGuide(storage);
    const first = await firstGuide.open(pullRequestOf(remote.pull));
    await firstGuide.waitForDeepCheck(first);
    const callsOfFirstRun = fakeClaude.calls().length;
    assert.deepStrictEqual([...new Set(fakeClaude.calls().map((call) => call.pass))].sort(), ["deep check", "overview"]);

    // A new ReviewGuide on the same storage is what VS Code has after a restart.
    const secondGuide = testReviewGuide(storage);
    const second = await secondGuide.open(pullRequestOf(remote.pull));
    await secondGuide.waitForDeepCheck(second);
    assert.strictEqual(fakeClaude.calls().length, callsOfFirstRun, "no further Claude call, for neither pass");
    assert.deepStrictEqual(second.runs.map((run) => [run.pass, run.fromCache]), [["overview", true], ["deep check", true]]);
    assert.deepStrictEqual(titlesByTier(second), titlesByTier(first));
    const packCodes = second.units.find((unit) => unit.symbolPath === "pack_codes")!;
    assert.deepStrictEqual(secondGuide.deepCheckOf(second, packCodes), firstGuide.deepCheckOf(first, packCodes));
  });

  it("after a new push, asks Claude only about the units whose change is different", async () => {
    const fakeClaude = useFakeClaude(scratch, {});
    const storage = path.join(scratch, "storage");
    await openAndWait(storage);
    pushNewHead(remote, { ...pythonHead, "qpeft/trainer.py": pythonHead["qpeft/trainer.py"].replace("2 if bits <= 3", "4 if bits <= 2") });

    const review = await openAndWait(storage);
    const calls = fakeClaude.calls().filter((call) => call.pass === "overview");
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[1].unitIds.length, 1, "only Trainer.learning_rate is sent again");
    assert.strictEqual(review.overview!.headSha, remote.headSha);
    assert.ok(review.units.every((unit) => sortingOf(review, unit)));
  });
});
