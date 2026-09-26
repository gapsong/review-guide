import * as assert from "assert";
import { finalSorting } from "../../src/analysis/finalSorting";
import { ReviewUnit } from "../../src/review/reviewUnit";

const unit: ReviewUnit = {
  id: "qpeft/packing.py#function:pack_codes",
  file: "qpeft/packing.py",
  kind: "function",
  symbolPath: "pack_codes",
  newRange: { start: 4, end: 9 },
  lines: [{ kind: "added", text: "    shift = 0", newLine: 6 }],
  hash: "abc",
  isTestFile: false,
};

describe("finalSorting", () => {
  it("keeps Claude's tier and reason", () => {
    assert.deepStrictEqual(finalSorting(unit, { tier: "skim", reason: "Only a rename." }), { tier: "skim", reason: "Only a rename." });
  });

  it("still gives a tier and a reason when Claude left the unit out", () => {
    assert.deepStrictEqual(finalSorting(unit, undefined), {
      tier: "check",
      reason: "Claude gave no tier for this change, so look at it yourself.",
    });
  });
});
