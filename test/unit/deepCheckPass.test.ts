import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { PullRequestReview, unitsOfTier } from "../../src/review/pullRequestReview";
import { deepCheckLimit, ReviewGuide } from "../../src/reviewGuide";
import { createFixtureRemote, FixtureRemote, makeTempDir, pullRequestOf, pushNewHead } from "../support/gitFixture";
import { pythonBase, pythonHead } from "../support/pythonFixture";
import { testReviewGuide, useFakeClaude } from "../support/testReviewGuide";

describe("pass 2: deep check of the critical units", () => {
  let scratch: string;

  beforeEach(() => {
    scratch = makeTempDir("deep-check");
  });

  afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  async function openAndWait(guide: ReviewGuide, remote: FixtureRemote): Promise<PullRequestReview> {
    const review = await guide.open(pullRequestOf(remote.pull));
    await guide.waitForDeepCheck(review);
    return review;
  }

  describe("F4: every critical unit gets at least one question tied to a line range in the new code", () => {
    it("keeps Claude's questions and ties them to the unit's file and lines", async () => {
      const remote = createFixtureRemote(scratch, pythonBase, pythonHead);
      useFakeClaude(scratch, { "qpeft/": "critical" });
      const guide = testReviewGuide(path.join(scratch, "storage"));
      const review = await openAndWait(guide, remote);

      const critical = unitsOfTier(review, "critical");
      assert.ok(critical.length >= 3);
      for (const unit of critical) {
        const questions = guide.deepCheckOf(review, unit)!.questions;
        assert.ok(questions.length >= 1, `${unit.id} has a question`);
        for (const question of questions) {
          assert.strictEqual(question.file, unit.file);
          assert.deepStrictEqual(question.lines, unit.newRange, "the fake asks about the unit's own lines");
          assert.strictEqual(question.isDefault, false);
          assertLinesExistInNewCode(review, question.file, question.lines);
        }
      }
    });

    it("keeps line numbers that Claude got wrong inside the file", async () => {
      const remote = createFixtureRemote(scratch, pythonBase, pythonHead);
      useFakeClaude(scratch, { "pack_codes(": "critical" });
      process.env.FAKE_CLAUDE_QUESTION_LINES = "900-1000";
      const guide = testReviewGuide(path.join(scratch, "storage"));
      const review = await openAndWait(guide, remote);

      const [unit] = unitsOfTier(review, "critical");
      const [question] = guide.deepCheckOf(review, unit)!.questions;
      assertLinesExistInNewCode(review, question.file, question.lines);
    });

    it("asks Claude again when it gave no question, then falls back to a default question", async () => {
      const remote = createFixtureRemote(scratch, pythonBase, pythonHead);
      // Trainer.learning_rate plus the three weakened tests: four critical units, one Claude call.
      const fakeClaude = useFakeClaude(scratch, { "Trainer.learning_rate": "critical" });
      process.env.FAKE_CLAUDE_NO_QUESTIONS = "1";
      const guide = testReviewGuide(path.join(scratch, "storage"));
      const review = await openAndWait(guide, remote);

      assert.strictEqual(unitsOfTier(review, "critical").length, 4);
      assert.strictEqual(fakeClaude.calls().filter((call) => call.pass === "deep check").length, 2, "the call and one retry");
      for (const unit of unitsOfTier(review, "critical")) {
        const [question] = guide.deepCheckOf(review, unit)!.questions;
        assert.strictEqual(question.isDefault, true);
        assert.match(question.text, /^Check: /);
        assert.deepStrictEqual(question.lines, unit.newRange);
      }
    });
  });

  it("moves cached questions with their unit when a push adds lines above it", async () => {
    const remote = createFixtureRemote(scratch, pythonBase, pythonHead);
    useFakeClaude(scratch, { "  unpack_codes()": "critical" });
    const storage = path.join(scratch, "storage");
    const firstGuide = testReviewGuide(storage);
    const first = await openAndWait(firstGuide, remote);
    const before = first.units.find((unit) => unit.symbolPath === "unpack_codes")!;
    const questionBefore = firstGuide.deepCheckOf(first, before)!.questions[0].lines;

    pushNewHead(remote, { ...pythonHead, "qpeft/packing.py": `import torch\nimport numpy\n${pythonHead["qpeft/packing.py"]}` });
    const secondGuide = testReviewGuide(storage);
    const second = await openAndWait(secondGuide, remote);
    const after = second.units.find((unit) => unit.symbolPath === "unpack_codes")!;
    assert.strictEqual(after.hash, before.hash, "the function itself did not change");
    assert.deepStrictEqual(secondGuide.deepCheckOf(second, after)!.questions[0].lines, { start: questionBefore.start + 2, end: questionBefore.end + 2 });
  });

  describe(`F8: with more than ${deepCheckLimit} critical units, pass 2 waits for the user's agreement`, () => {
    it("does not start pass 2 before the user agrees, and starts it once they do", async () => {
      const remote = createFixtureRemote(scratch, manyFunctions(26, 0), manyFunctions(26, 1));
      const fakeClaude = useFakeClaude(scratch, { "many.py": "critical" });
      const asked: number[] = [];
      let agree: (answer: boolean) => void = () => undefined;
      const guide = testReviewGuide(path.join(scratch, "storage"), (count) => {
        asked.push(count);
        return new Promise<boolean>((resolve) => (agree = resolve));
      });

      const review = await guide.open(pullRequestOf(remote.pull));
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.deepStrictEqual(asked, [26], "the user is asked, with the number of critical units");
      assert.strictEqual(fakeClaude.calls().filter((call) => call.pass === "deep check").length, 0, "pass 2 has not started");
      assert.match(review.status!, /Pass 2 waits for you: 26 critical units/);

      agree(true);
      await guide.waitForDeepCheck(review);
      assert.ok(fakeClaude.calls().filter((call) => call.pass === "deep check").length > 0);
      assert.ok(unitsOfTier(review, "critical").every((unit) => guide.deepCheckOf(review, unit)));
    });

    it("does not run pass 2 when the user says no, until they start it themselves", async () => {
      const remote = createFixtureRemote(scratch, manyFunctions(26, 0), manyFunctions(26, 1));
      const fakeClaude = useFakeClaude(scratch, { "many.py": "critical" });
      const guide = testReviewGuide(path.join(scratch, "storage"), async () => false);

      const review = await openAndWait(guide, remote);
      assert.strictEqual(fakeClaude.calls().filter((call) => call.pass === "deep check").length, 0);

      guide.startDeepCheck(review);
      await guide.waitForDeepCheck(review);
      assert.ok(fakeClaude.calls().filter((call) => call.pass === "deep check").length > 0);
    });

    it(`starts pass 2 without asking for ${deepCheckLimit} critical units`, async () => {
      const remote = createFixtureRemote(scratch, manyFunctions(deepCheckLimit, 0), manyFunctions(deepCheckLimit, 1));
      const fakeClaude = useFakeClaude(scratch, { "many.py": "critical" });
      let asked = false;
      const guide = testReviewGuide(path.join(scratch, "storage"), async () => (asked = true));

      const review = await openAndWait(guide, remote);
      assert.strictEqual(unitsOfTier(review, "critical").length, deepCheckLimit);
      assert.strictEqual(asked, false);
      assert.ok(fakeClaude.calls().filter((call) => call.pass === "deep check").length > 0);
    });
  });
});

function assertLinesExistInNewCode(review: PullRequestReview, file: string, lines: { start: number; end: number }): void {
  const lineCount = fs.readFileSync(path.join(review.checkout.worktreePath, file), "utf8").split("\n").length;
  assert.ok(1 <= lines.start && lines.start <= lines.end && lines.end <= lineCount, `${file} ${lines.start}-${lines.end} lies in the new file`);
}

// A file with `count` functions; `offset` changes every function body.
function manyFunctions(count: number, offset: number): Record<string, string> {
  const functions = Array.from({ length: count }, (_, index) => `def f${index}():\n    return ${index + offset}\n`);
  return { "many.py": functions.join("\n\n") };
}
