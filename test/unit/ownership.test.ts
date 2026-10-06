import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { unitsOfTier } from "../../src/review/pullRequestReview";
import { describeThreeAmCheck, ownershipByFile, threeAmCheck } from "../../src/state/ownership";
import { ownershipPrompt } from "../../src/claude/ownershipPrompt";
import { ReviewUnit } from "../../src/review/reviewUnit";
import { UnitRecord } from "../../src/state/reviewState";
import { addPullRequest, createFixtureRemote, makeTempDir, pullRequestOf } from "../support/gitFixture";
import { pythonBase, pythonHead } from "../support/pythonFixture";
import { testReviewGuide, useFakeClaude } from "../support/testReviewGuide";

describe("ownership check (F11), ownership overview (F12) and the 3am check (F14)", () => {
  let scratch: string;

  beforeEach(() => {
    scratch = makeTempDir("ownership");
  });

  afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  async function openPackingPullRequest() {
    const remote = createFixtureRemote(scratch, pythonBase, pythonHead, 8);
    // Two spaces before the title, so "unpack_codes()" does not match.
    const fakeClaude = useFakeClaude(scratch, { "  pack_codes()": "critical" });
    const guide = testReviewGuide(path.join(scratch, "storage"));
    const review = await guide.open(pullRequestOf(remote.pull));
    await guide.waitForDeepCheck(review);
    const packCodes = review.units.find((unit) => unit.symbolPath === "pack_codes")!;
    return { remote, fakeClaude, guide, review, packCodes };
  }

  describe("F11: the reviewer explains a critical unit; Claude answers understood, almost or not yet", () => {
    it("'not yet' names what is wrong and the line, and does not mark the unit understood", async () => {
      const { guide, review, packCodes } = await openPackingPullRequest();
      const result = await guide.sendOwnershipMessage(review, packCodes.id, "It shifts each code by the word size, which is wrong I guess.");
      assert.deepStrictEqual(result, { verdict: "not yet", feedback: "Line 5 shifts by bits, not by the word size.", line: 5 });
      assert.strictEqual(guide.recordOf(review, packCodes)!.state, "read");
    });

    it("'almost' names what is missing, and does not mark the unit understood", async () => {
      const { guide, review, packCodes } = await openPackingPullRequest();
      const result = await guide.sendOwnershipMessage(review, packCodes.id, "It packs codes, partly by shifting.");
      assert.deepStrictEqual(result, { verdict: "almost", feedback: "What happens at a 3-bit word boundary?" });
      assert.strictEqual(guide.recordOf(review, packCodes)!.state, "read");
    });

    it("only 'understood' marks the unit understood, and the explanation is stored with the verdict", async () => {
      const { fakeClaude, guide, review, packCodes } = await openPackingPullRequest();
      const explanation = "It shifts each code by bits times its position within the 32-bit word.";
      const result = await guide.sendOwnershipMessage(review, packCodes.id, explanation);
      assert.strictEqual(result.verdict, "understood");
      const record = guide.recordOf(review, packCodes)!;
      assert.strictEqual(record.state, "understood");
      assert.strictEqual(record.explanation, explanation);
      assert.deepStrictEqual(record.lastCheck, result);
      const call = fakeClaude.calls().find((candidate) => candidate.pass === "ownership check")!;
      assert.strictEqual(call.cwd, review.checkout.worktreePath, "the same read-only call, in the PR worktree");
    });

    it("a later wrong explanation takes 'understood' away again", async () => {
      const { guide, review, packCodes } = await openPackingPullRequest();
      await guide.sendOwnershipMessage(review, packCodes.id, "It shifts each code into place.");
      await guide.sendOwnershipMessage(review, packCodes.id, "Now I think this is wrong.");
      assert.strictEqual(guide.recordOf(review, packCodes)!.state, "read");
    });
  });

  describe("F15: the ownership check is a chat", () => {
    it("keeps the unit, the reviewer's earlier messages and the code as context, and lets the verdict change", async () => {
      const { fakeClaude, guide, review, packCodes } = await openPackingPullRequest();
      const first = await guide.sendOwnershipMessage(review, packCodes.id, "It packs codes, partly by shifting.");
      assert.strictEqual(first.verdict, "almost");
      const answer = await guide.sendOwnershipMessage(review, packCodes.id, "Why does the shift wrap at 32?");
      assert.strictEqual(answer.verdict, "almost");
      assert.match(answer.feedback, /```/, "Claude's answer can carry a diagram");
      const last = await guide.sendOwnershipMessage(review, packCodes.id, "Each code goes to bits*position, wrapping into the next 32-bit word.");
      assert.strictEqual(last.verdict, "understood");

      const calls = fakeClaude.calls().filter((call) => call.pass === "ownership check");
      assert.deepStrictEqual(calls.map((call) => call.unitIds[0]), ["turns-before:0", "turns-before:1", "turns-before:2"], "every turn sees the earlier ones");
      assert.ok(calls.every((call) => call.cwd === review.checkout.worktreePath), "read-only, in the PR worktree (the fake checks the flags)");

      // A new store on the same folder is what VS Code has after a restart.
      const record = testReviewGuide(path.join(scratch, "storage")).recordOf(review, packCodes)!;
      assert.deepStrictEqual(record.conversation!.map((turn) => turn.speaker === "reviewer" ? `reviewer: ${turn.text}` : `claude: ${turn.result.verdict}`), [
        "reviewer: It packs codes, partly by shifting.",
        "claude: almost",
        "reviewer: Why does the shift wrap at 32?",
        "claude: almost",
        "reviewer: Each code goes to bits*position, wrapping into the next 32-bit word.",
        "claude: understood",
      ]);
      assert.strictEqual(record.explanation, "It packs codes, partly by shifting.", "the first try is what unlocks Claude's summary");
      assert.strictEqual(record.state, "understood");
    });

    it("tells Claude not to explain before the reviewer's first try, and to answer their questions after it", () => {
      const first = ownershipPrompt(packCodesUnit(), [], "It packs codes.");
      assert.match(first, /first try/);
      assert.match(first, /Do not explain the code to them yet/);
      const later = ownershipPrompt(packCodesUnit(), [
        { speaker: "reviewer", text: "It packs codes." },
        { speaker: "claude", result: { verdict: "almost", feedback: "What about the word boundary?" } },
      ], "Why 32?");
      assert.match(later, /\*\*Reviewer:\*\* It packs codes\./);
      assert.match(later, /\*\*Claude \(almost\):\*\* What about the word boundary\?/);
      assert.match(later, /ask you back/);
      assert.match(later, /Your own explanations do not count as their understanding/);
    });
  });

  it("F12: lists per file how many critical units the reviewer has understood, across all PRs of the repo", async () => {
    const { remote, guide, review, packCodes } = await openPackingPullRequest();
    await guide.sendOwnershipMessage(review, packCodes.id, "It shifts each code into place.");
    const secondPull = addPullRequest(remote, {
      ...pythonBase,
      "qpeft/packing.py": pythonBase["qpeft/packing.py"].replace("words.append(code)", "words.append(code & 0xF)"),
    }, 9);
    const second = await guide.open(pullRequestOf(secondPull));
    await guide.waitForDeepCheck(second);

    assert.deepStrictEqual(guide.ownershipOf(review.pullRequest.repo), [
      { file: "qpeft/packing.py", understood: 1, critical: 2 },
      { file: "tests/test_packing.py", understood: 0, critical: 3 },
    ]);
  });

  describe("F14: the 3am check of a PR", () => {
    it("counts understood, read and unread critical units, and says 'owned' only when all are understood", async () => {
      const { guide, review } = await openPackingPullRequest();
      const critical = unitsOfTier(review, "critical");
      assert.strictEqual(critical.length, 4, "pack_codes and three weakened tests");
      assert.strictEqual(describeThreeAmCheck(guide.threeAmCheckOf(review)), "3am: 0 understood · 0 read · 4 unread");

      guide.setReadState(review, critical[0].id, "read");
      await guide.sendOwnershipMessage(review, critical[1].id, "It is right.");
      assert.strictEqual(describeThreeAmCheck(guide.threeAmCheckOf(review)), "3am: 1 understood · 1 read · 2 unread");

      for (const unit of critical) {
        await guide.sendOwnershipMessage(review, unit.id, "It is right.");
      }
      assert.strictEqual(guide.threeAmCheckOf(review).owned, true);
      assert.strictEqual(describeThreeAmCheck(guide.threeAmCheckOf(review)), "3am: owned");
    });

    it("reading every critical unit is not owning it", () => {
      const read = [record("read"), record("read")];
      assert.deepStrictEqual(threeAmCheck(read), { understood: 0, read: 2, unread: 0, owned: false });
      assert.strictEqual(threeAmCheck([record("understood"), record("read")]).owned, false);
      assert.strictEqual(threeAmCheck([record("understood"), record("understood")]).owned, true);
    });
  });

  it("counts only critical units in the overview", () => {
    const records = [record("understood", "critical", "a.py"), record("understood", "skim", "a.py"), record("unread", "critical", "a.py")];
    assert.deepStrictEqual(ownershipByFile(records), [{ file: "a.py", understood: 1, critical: 2 }]);
  });
});

function record(state: UnitRecord["state"], tier: UnitRecord["tier"] = "critical", file = "a.py"): UnitRecord {
  return { pullRequestNumber: 1, unitId: `${file}#${Math.random()}`, file, hash: "h", tier, state, changedSinceReview: false };
}

function packCodesUnit(): ReviewUnit {
  return {
    id: "qpeft/packing.py#function:pack_codes",
    file: "qpeft/packing.py",
    kind: "function",
    symbolPath: "pack_codes",
    newRange: { start: 4, end: 9 },
    lines: [{ kind: "added", text: "    shift = 0", newLine: 6 }],
    hash: "h",
    isTestFile: false,
    existedBefore: true,
  };
}
