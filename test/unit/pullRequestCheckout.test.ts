import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { PullRequestCheckouts } from "../../src/git/pullRequestCheckout";
import { fileSides, readChangedFiles, writeFileSides } from "../../src/git/pullRequestFiles";
import { createFixtureRemote, fingerprint, git, makeTempDir, pullRequestOf, pushNewHead } from "../support/gitFixture";

describe("F2: opening a PR checks out its head into a separate worktree", () => {
  let scratch: string;

  beforeEach(() => {
    scratch = makeTempDir("checkout");
  });

  afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it("puts the head in a worktree in the extension's storage and leaves the user's working copy unchanged", async () => {
    const remote = createFixtureRemote(scratch, { "packing.py": "def pack():\n    return 1\n" }, { "packing.py": "def pack():\n    return 2\n", "new.py": "x = 1\n" });
    const workingCopy = cloneWithLocalEdits(remote.remotePath, scratch);
    const before = { files: fingerprint(workingCopy), status: git(workingCopy, "status", "--porcelain") };

    const checkouts = new PullRequestCheckouts(path.join(scratch, "storage"), async () => ({}));
    const checkout = await checkouts.checkOut(pullRequestOf(remote.pull));

    assert.ok(checkout.worktreePath.startsWith(path.join(scratch, "storage")));
    assert.strictEqual(git(checkout.worktreePath, "rev-parse", "HEAD"), remote.headSha);
    assert.strictEqual(fs.readFileSync(path.join(checkout.worktreePath, "packing.py"), "utf8"), "def pack():\n    return 2\n");
    assert.strictEqual(checkout.mergeBaseSha, remote.baseSha);
    assert.strictEqual(fingerprint(workingCopy), before.files, "no byte of the working copy (or its .git) changed");
    assert.strictEqual(git(workingCopy, "status", "--porcelain"), before.status);
  });

  it("writes the base version of every changed file for the left side of the diff", async () => {
    const remote = createFixtureRemote(scratch, { "a.py": "old\n", "gone.py": "bye\n" }, { "a.py": "new\n", "added.py": "hi\n" });
    const checkout = await new PullRequestCheckouts(path.join(scratch, "storage"), async () => ({})).checkOut(pullRequestOf(remote.pull));
    const files = await readChangedFiles(checkout);
    await writeFileSides(checkout, files);

    const sides = Object.fromEntries(files.map((file) => [file.newPath, fileSides(checkout, file)]));
    assert.deepStrictEqual(Object.keys(sides).sort(), ["a.py", "added.py", "gone.py"]);
    assert.strictEqual(fs.readFileSync(sides["a.py"].basePath, "utf8"), "old\n");
    assert.strictEqual(fs.readFileSync(sides["a.py"].headPath, "utf8"), "new\n");
    assert.strictEqual(fs.readFileSync(sides["added.py"].basePath, "utf8"), "");
    assert.strictEqual(fs.readFileSync(sides["gone.py"].basePath, "utf8"), "bye\n");
    assert.strictEqual(fs.readFileSync(sides["gone.py"].headPath, "utf8"), "");
  });

  it("moves the worktree to the new head after another push, and removes it when the PR is closed", async () => {
    const remote = createFixtureRemote(scratch, { "a.py": "1\n" }, { "a.py": "2\n" });
    const checkouts = new PullRequestCheckouts(path.join(scratch, "storage"), async () => ({}));
    const first = await checkouts.checkOut(pullRequestOf(remote.pull));
    const newHead = pushNewHead(remote, { "a.py": "3\n" });

    const second = await checkouts.checkOut(pullRequestOf(remote.pull));
    assert.strictEqual(second.worktreePath, first.worktreePath);
    assert.strictEqual(second.headSha, newHead);
    assert.strictEqual(fs.readFileSync(path.join(second.worktreePath, "a.py"), "utf8"), "3\n");

    await checkouts.remove(pullRequestOf(remote.pull));
    assert.strictEqual(fs.existsSync(second.worktreePath), false);
    assert.strictEqual(git(second.mirrorPath, "worktree", "list").split("\n").length, 1, "only the mirror itself is left");
  });
});

function cloneWithLocalEdits(remotePath: string, scratch: string): string {
  const workingCopy = path.join(scratch, "working-copy");
  git(scratch, "clone", "--quiet", remotePath, workingCopy);
  fs.writeFileSync(path.join(workingCopy, "packing.py"), "unsaved local work\n");
  fs.writeFileSync(path.join(workingCopy, "notes.txt"), "untracked\n");
  return workingCopy;
}
