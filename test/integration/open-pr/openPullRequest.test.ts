import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { ReviewGuideApi } from "../../../src/extension";
import { PullRequest } from "../../../src/github/pullRequest";
import { unitTitle } from "../../../src/review/reviewUnit";
import { FakeGitHub } from "../../support/fakeGitHub";
import { createFixtureRemote, fingerprint, git, makeTempDir, pullRequestOf } from "../../support/gitFixture";
import { baseFiles, headFiles } from "../../support/typescriptFixture";
import { startExtension } from "../standInGitHubLogin";

describe("opening a PR in VS Code", () => {
  const github = new FakeGitHub("token");
  let api: ReviewGuideApi;
  let workingCopy: string;
  let pullRequest: PullRequest;

  before(async () => {
    const remote = createFixtureRemote(makeTempDir("open-pr"), baseFiles, headFiles, 12);
    workingCopy = vscode.workspace.workspaceFolders![0].uri.fsPath;
    git(workingCopy, "clone", "--quiet", remote.remotePath, ".");
    fs.writeFileSync(path.join(workingCopy, "src", "packing.ts"), "// unsaved local work\n");
    github.addPull("reviewer/packing", remote.pull);
    api = await startExtension(github, "token", ["reviewer/packing"]);
    pullRequest = pullRequestOf(remote.pull, { owner: "reviewer", name: "packing" });
  });

  after(() => github.stop());

  it("F2: checks out the head into a worktree in the extension's storage; the working copy is not changed", async () => {
    // `git status` refreshes .git/index, so it runs before the fingerprint is taken.
    const status = git(workingCopy, "status", "--porcelain");
    const before = { files: fingerprint(workingCopy), status };
    await vscode.commands.executeCommand("reviewGuide.openPullRequest", pullRequest);

    const review = api.reviewGuide.reviewOf(pullRequest)!;
    assert.ok(review, "the PR is open");
    const worktree = review.checkout.worktreePath;
    assert.ok(!worktree.startsWith(workingCopy), "the worktree is not inside the working copy");
    assert.ok(worktree.includes("gapsong.review-guide"), "the worktree lives in the extension's global storage");
    assert.strictEqual(git(worktree, "rev-parse", "HEAD"), review.pullRequest.headSha);
    assert.strictEqual(fs.readFileSync(path.join(worktree, "src", "packing.ts"), "utf8"), headFiles["src/packing.ts"]);
    assert.strictEqual(fingerprint(workingCopy), before.files);
    assert.strictEqual(git(workingCopy, "status", "--porcelain"), before.status);
  });

  it("finds review units with the document symbols of VS Code's language support", () => {
    const review = api.reviewGuide.reviewOf(pullRequest)!;
    const titles = review.units.map((unit) => `${unit.file}: ${unitTitle(unit)}`).sort();
    assert.deepStrictEqual(titles, [
      "README.md: (outside functions)",
      "src/packing.ts: codesPerWord()",
      "src/packing.ts: packCodes()",
      "src/packing.ts: unpackCodes()",
    ]);
  });

  it("opens the diff (base vs head) at the clicked unit and shows it in the guide panel", async () => {
    const review = api.reviewGuide.reviewOf(pullRequest)!;
    const unit = review.units.find((candidate) => candidate.symbolPath === "unpackCodes")!;
    await vscode.commands.executeCommand("reviewGuide.openUnit", pullRequest, unit.id);

    const tab = vscode.window.tabGroups.activeTabGroup.activeTab!;
    assert.ok(tab.input instanceof vscode.TabInputTextDiff, "the active tab is a diff");
    assert.strictEqual(tab.input.original.fsPath, path.join(review.checkout.folderPath, "base", "src", "packing.ts"));
    assert.strictEqual(tab.input.modified.fsPath, path.join(review.checkout.worktreePath, "src", "packing.ts"));
    const editor = vscode.window.activeTextEditor!;
    assert.strictEqual(editor.document.uri.fsPath, tab.input.modified.fsPath);
    assert.strictEqual(editor.selection.start.line + 1, unit.newRange.start);
    assert.strictEqual(unit.newRange.start, 14, "the changed line of unpackCodes");

    assert.strictEqual(api.guideView.model?.title, "unpackCodes()");
    assert.ok(api.guideView.html?.includes("unpackCodes()"));
  });
});
