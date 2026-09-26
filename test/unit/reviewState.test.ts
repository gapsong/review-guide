import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { ReviewUnit } from "../../src/review/reviewUnit";
import { ReviewStateStore } from "../../src/state/reviewState";
import { makeTempDir } from "../support/gitFixture";

const repo = { owner: "reviewer", name: "qpeft" };

function unit(hash: string): ReviewUnit {
  return {
    id: "qpeft/packing.py#function:pack_codes",
    file: "qpeft/packing.py",
    kind: "function",
    symbolPath: "pack_codes",
    newRange: { start: 4, end: 9 },
    lines: [],
    hash,
    isTestFile: false,
  };
}

describe("read marks and ownership state", () => {
  let folder: string;

  beforeEach(() => {
    folder = makeTempDir("state");
  });

  afterEach(() => {
    fs.rmSync(folder, { recursive: true, force: true });
  });

  it("keeps read marks in a file, so a new store (after a restart) sees them", () => {
    new ReviewStateStore(folder).setReadState(repo, 8, unit("h1"), "read");
    assert.strictEqual(new ReviewStateStore(folder).recordOf(repo, 8, unit("h1").id)!.state, "read");
    assert.ok(fs.existsSync(path.join(folder, "reviewer", "qpeft.json")));
  });

  it("keeps the state of a unit whose code did not change after a new push", () => {
    const store = new ReviewStateStore(folder);
    store.updateUnits(repo, 8, [{ unit: unit("h1"), tier: "critical" }]);
    store.setReadState(repo, 8, unit("h1"), "read");
    store.updateUnits(repo, 8, [{ unit: unit("h1"), tier: "critical" }]);
    const record = store.recordOf(repo, 8, unit("h1").id)!;
    assert.strictEqual(record.state, "read");
    assert.strictEqual(record.changedSinceReview, false);
  });

  it("sets a read unit back to unread when its code changes, and flags it", () => {
    const store = new ReviewStateStore(folder);
    store.setReadState(repo, 8, unit("h1"), "read");
    store.updateUnits(repo, 8, [{ unit: unit("h2"), tier: "critical" }]);
    const record = store.recordOf(repo, 8, unit("h1").id)!;
    assert.strictEqual(record.state, "unread");
    assert.strictEqual(record.changedSinceReview, true);
  });

  it("sets an understood unit back to read when its code changes, and flags it", () => {
    const store = new ReviewStateStore(folder);
    store.saveOwnershipCheck(repo, 8, unit("h1"), "It packs codes.", { verdict: "understood", feedback: "Right." });
    store.updateUnits(repo, 8, [{ unit: unit("h2"), tier: "critical" }]);
    const record = store.recordOf(repo, 8, unit("h1").id)!;
    assert.strictEqual(record.state, "read");
    assert.strictEqual(record.changedSinceReview, true);
  });

  it("does not flag a unit that was never read", () => {
    const store = new ReviewStateStore(folder);
    store.updateUnits(repo, 8, [{ unit: unit("h1"), tier: "skim" }]);
    store.updateUnits(repo, 8, [{ unit: unit("h2"), tier: "skim" }]);
    assert.strictEqual(store.recordOf(repo, 8, unit("h1").id)!.changedSinceReview, false);
  });
});
