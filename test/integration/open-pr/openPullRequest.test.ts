import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { ReviewGuideApi } from "../../../src/extension";
import { PullRequest } from "../../../src/github/pullRequest";
import { unitTitle } from "../../../src/review/reviewUnit";
import { FakeGitHub } from "../../support/fakeGitHub";
import { createFixtureRemote, fingerprint, git, makeTempDir, pullRequestOf } from "../../support/gitFixture";
import { useFakeClaude } from "../../support/testReviewGuide";
import { baseFiles, headFiles } from "../../support/typescriptFixture";
import { findUnitNode, firstPullRequestNode } from "../sideBar";
import { startExtension } from "../standInGitHubLogin";

describe("opening a PR in VS Code", () => {
  const github = new FakeGitHub("token");
  let api: ReviewGuideApi;
  let workingCopy: string;
  let pullRequest: PullRequest;

  before(async () => {
    const scratch = makeTempDir("open-pr");
    useFakeClaude(scratch, { "packCodes()": "critical", "codesPerWord()": "check" });
    const remote = createFixtureRemote(scratch, baseFiles, headFiles, 12);
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

  it("F5: clicking a unit opens the diff (base vs head) at the unit, and the guide shows its tier, reason and questions", async () => {
    const review = api.reviewGuide.reviewOf(pullRequest)!;
    await api.reviewGuide.waitForDeepCheck(review);
    const unit = review.units.find((candidate) => candidate.symbolPath === "unpackCodes")!;
    const unitNode = await findUnitNode(api, "unpackCodes()");
    const click = api.pullRequestTree.getTreeItem(unitNode).command!;
    await vscode.commands.executeCommand(click.command, ...click.arguments!);

    const tab = vscode.window.tabGroups.activeTabGroup.activeTab!;
    assert.ok(tab.input instanceof vscode.TabInputTextDiff, "the active tab is a diff");
    assert.strictEqual(tab.input.original.fsPath, path.join(review.checkout.folderPath, "base", "src", "packing.ts"));
    assert.strictEqual(tab.input.modified.fsPath, path.join(review.checkout.worktreePath, "src", "packing.ts"));
    const editor = vscode.window.activeTextEditor!;
    assert.strictEqual(editor.document.uri.fsPath, tab.input.modified.fsPath);
    assert.strictEqual(editor.selection.start.line + 1, unit.newRange.start);
    assert.strictEqual(unit.newRange.start, 14, "the changed line of unpackCodes");

    const guide = api.guideView.model!;
    assert.strictEqual(guide.title, "unpackCodes()");
    assert.strictEqual(guide.tier, "critical");
    assert.strictEqual(guide.reason, "Fake reason for src/packing.ts  unpackCodes().");
    assert.deepStrictEqual(guide.deepCheck!.questions.map((question) => [question.text, question.lines]), [
      ["Check: what happens at line 14?", unit.newRange],
    ]);
    const html = api.guideView.html!;
    const lines = `lines ${unit.newRange.start}-${unit.newRange.end}`;
    for (const shown of ["unpackCodes()", "critical", "Fake reason for src/packing.ts  unpackCodes().", "Check: what happens at line 14?", lines]) {
      assert.ok(html.includes(shown), `the guide panel shows "${shown}"`);
    }
  });

  it("shows the tiers in the side bar, with the reason next to each unit", async () => {
    const tree = api.pullRequestTree;
    const labels = (await tree.getChildren(await firstPullRequestNode(api))).map((node) => tree.getTreeItem(node).label);
    assert.deepStrictEqual(labels.slice(0, 5), ["What this PR does", "No .review-guide.md: see Claude's draft", "Critical (2)", "Check (1)", "Skim (1)"]);
    const unitItem = tree.getTreeItem(await findUnitNode(api, "packCodes()"));
    assert.strictEqual(unitItem.description, "Fake reason for src/packing.ts  packCodes().");
  });

  it("F11 in VS Code: The reviewer explains the shown unit in the guide panel and sees Claude's verdict", async () => {
    const unitNode = await findUnitNode(api, "unpackCodes()");
    const click = api.pullRequestTree.getTreeItem(unitNode).command!;
    await vscode.commands.executeCommand(click.command, ...click.arguments!);
    assert.ok(!api.guideView.html!.includes("Fake plain words"), "Claude's summary stays hidden before the reviewer has written his");

    await api.guideView.receive({ type: "draft", text: "It masks the low" });
    const review = api.reviewGuide.reviewOf(pullRequest)!;
    api.reviewGuide.setReadState(review, review.units.find((unit) => unit.symbolPath === "unpackCodes")!.id, "read");
    assert.ok(api.guideView.html!.includes("It masks the low</textarea>"), "a redraw keeps what the reviewer has typed");

    await api.guideView.receive({ type: "explain", text: "It masks the low bits, partly." });
    assert.strictEqual(api.guideView.model!.lastCheck!.verdict, "almost");
    assert.ok(api.guideView.html!.includes("What happens at a 3-bit word boundary?"));
    assert.ok(api.guideView.html!.includes("Fake plain words for src/packing.ts  unpackCodes()."), "shown once the reviewer has written his");
    assert.strictEqual(api.guideView.model!.readState, "read");

    await api.guideView.receive({ type: "explain", text: "It masks the low bits of each word after an unsigned shift." });
    assert.strictEqual(api.guideView.model!.lastCheck!.verdict, "understood");
    assert.strictEqual(api.guideView.model!.readState, "understood");
  });

  it("F14 in VS Code: the PR header shows the 3am check", async () => {
    const header = api.pullRequestTree.getTreeItem(await firstPullRequestNode(api));
    assert.strictEqual(header.description, "feature -> main  [1/4 read]  3am: 1 understood · 0 read · 1 unread");

    const packCodes = await findUnitNode(api, "packCodes()");
    const click = api.pullRequestTree.getTreeItem(packCodes).command!;
    await vscode.commands.executeCommand(click.command, ...click.arguments!);
    await api.guideView.receive({ type: "explain", text: "It shifts each code into its place in the word." });
    const owned = api.pullRequestTree.getTreeItem(await firstPullRequestNode(api));
    assert.strictEqual(owned.description, "feature -> main  [2/4 read]  3am: owned");
  });

  it("F12 in VS Code: the Ownership view lists understood critical units per file", async () => {
    const tree = api.ownershipTree;
    const [repo] = await tree.getChildren();
    const files = (await tree.getChildren(repo)).map((node) => tree.getTreeItem(node).label);
    assert.deepStrictEqual(files, ["src/packing.ts 2/2"]);
  });
});
