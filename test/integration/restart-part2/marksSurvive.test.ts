import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { ReviewGuideApi } from "../../../src/extension";
import { FakeGitHub } from "../../support/fakeGitHub";
import { useFakeClaude } from "../../support/testReviewGuide";
import { restartFixture } from "../restartFixture";
import { findUnitNode, firstPullRequestNode } from "../sideBar";
import { startExtension } from "../standInGitHubLogin";

// F6, second half: a new VS Code process on the same user data dir as restart-part1.
describe("F6 (after the restart): read marks survive a restart of VS Code", () => {
  const github = new FakeGitHub("token");
  let api: ReviewGuideApi;
  let fakeClaude: ReturnType<typeof useFakeClaude>;

  before(async () => {
    const remote = restartFixture();
    const logFolder = path.join(process.env.REVIEW_GUIDE_TEST_SCRATCH!, "restart-fixture", "after-restart");
    fs.mkdirSync(logFolder, { recursive: true });
    fakeClaude = useFakeClaude(logFolder, { "packCodes()": "critical" });
    github.addPull("reviewer/packing", remote.pull);
    api = await startExtension(github, "token", ["reviewer/packing"]);
  });

  after(() => github.stop());

  it("shows packCodes() as read and the other units as unread after reopening the PR", async () => {
    const prNode = await firstPullRequestNode(api);
    const open = api.pullRequestTree.getTreeItem(prNode).command!;
    await vscode.commands.executeCommand(open.command, ...open.arguments!);

    const tree = api.pullRequestTree;
    assert.strictEqual(tree.getTreeItem(await findUnitNode(api, "packCodes()")).contextValue, "unit-read");
    assert.strictEqual(tree.getTreeItem(await findUnitNode(api, "unpackCodes()")).contextValue, "unit-unread");
  });

  it("F7 in VS Code: the reopened PR on the same head calls Claude for neither pass", async () => {
    const prNode = await firstPullRequestNode(api);
    assert.ok(prNode.kind === "pullRequest");
    const review = api.reviewGuide.reviewOf(prNode.pullRequest)!;
    await api.reviewGuide.waitForDeepCheck(review);
    assert.deepStrictEqual(fakeClaude.calls(), []);
    assert.ok(review.runs.every((run) => run.fromCache));
  });
});
