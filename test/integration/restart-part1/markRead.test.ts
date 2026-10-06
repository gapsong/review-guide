import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import type { ReviewGuideApi } from "../../../src/extension";
import { FakeGitHub } from "../../support/fakeGitHub";
import { pullRequestOf } from "../../support/gitFixture";
import { useFakeClaude } from "../../support/testReviewGuide";
import { restartFixture } from "../restartFixture";
import { findUnitNode } from "../sideBar";
import { startExtension } from "../standInGitHubLogin";

// F6, first half: mark a unit as read. restart-part2 starts a new VS Code on the same user data.
describe("F6 (before the restart): mark a unit as read", () => {
  const github = new FakeGitHub("token");
  let api: ReviewGuideApi;

  before(async () => {
    const remote = restartFixture();
    useFakeClaude(path.join(process.env.REVIEW_GUIDE_TEST_SCRATCH!, "restart-fixture"), { "packCodes()": "critical" });
    github.addPull("example/packing", remote.pull);
    api = await startExtension(github, "token", ["example/packing"]);
    const review = await api.reviewGuide.open(pullRequestOf(remote.pull, { owner: "example", name: "packing" }));
    await api.reviewGuide.waitForDeepCheck(review);
  });

  after(() => github.stop());

  it("marks packCodes() as read with the side bar's button", async () => {
    const node = await findUnitNode(api, "packCodes()");
    assert.strictEqual(api.pullRequestTree.getTreeItem(node).contextValue, "unit-unread");
    await vscode.commands.executeCommand("reviewGuide.markRead", node);
    const after = await findUnitNode(api, "packCodes()");
    assert.strictEqual(api.pullRequestTree.getTreeItem(after).contextValue, "unit-read");
  });
});
