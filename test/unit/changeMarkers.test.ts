import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { ChangeMarkers, changeText, ConfirmationStore, isExplanationOlder } from "../../src/codemap/changeMarkers";
import { git, makeTempDir } from "../support/gitFixture";

describe("change markers on codemap entries", () => {
  let repo: string;
  let storage: string;
  let markers: ChangeMarkers;

  beforeEach(() => {
    repo = makeTempDir("markers-repo");
    storage = makeTempDir("markers-storage");
    markers = new ChangeMarkers(new ConfirmationStore(storage));
    git(repo, "init", "--quiet", "--initial-branch=main");
    commit({ "shop/payment.py": "v1\n", "shop/cart/cart.py": "v1\n", "app/[id]/page.tsx": "v1\n" }, "Start the shop");
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(storage, { recursive: true, force: true });
  });

  function commit(files: Record<string, string>, message: string): void {
    for (const [filePath, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(repo, filePath)), { recursive: true });
      fs.writeFileSync(path.join(repo, filePath), content);
    }
    git(repo, "add", "--all");
    git(repo, "commit", "--quiet", "-m", message);
  }

  async function changes(...paths: string[]): Promise<Record<string, number | undefined | "none">> {
    const statuses = await markers.check(repo, paths);
    return Object.fromEntries(paths.map((repoPath) => {
      const change = statuses.get(repoPath)!.change;
      return [repoPath, change ? change.commits : "none"];
    }));
  }

  it("marks nothing the first time an entry is seen: the current HEAD is its confirmation", async () => {
    assert.deepStrictEqual(await changes("shop/payment.py", "shop/cart"), { "shop/payment.py": "none", "shop/cart": "none" });
  });

  it("marks an entry after a commit changes its path, and counts the commits", async () => {
    await changes("shop/payment.py", "shop/cart");
    commit({ "shop/payment.py": "v2\n" }, "Charge twice");
    commit({ "shop/payment.py": "v3\n" }, "Charge once again");
    assert.deepStrictEqual(await changes("shop/payment.py", "shop/cart"), { "shop/payment.py": 2, "shop/cart": "none" });
  });

  it("marks a folder entry when a commit changes a file inside it", async () => {
    await changes("shop/cart");
    commit({ "shop/cart/cart.py": "v2\n" }, "Keep prices");
    assert.deepStrictEqual(await changes("shop/cart"), { "shop/cart": 1 });
  });

  it("does not count edits that are not committed yet", async () => {
    await changes("shop/payment.py");
    fs.writeFileSync(path.join(repo, "shop", "payment.py"), "uncommitted\n");
    git(repo, "add", "shop/payment.py");
    assert.deepStrictEqual(await changes("shop/payment.py"), { "shop/payment.py": "none" });
  });

  it("clears the mark when the owner says it is still true, until the next commit", async () => {
    await changes("shop/payment.py");
    commit({ "shop/payment.py": "v2\n" }, "Charge twice");
    await markers.confirm(repo, "shop/payment.py");
    assert.deepStrictEqual(await changes("shop/payment.py"), { "shop/payment.py": "none" });
    commit({ "shop/payment.py": "v3\n" }, "Charge once again");
    assert.deepStrictEqual(await changes("shop/payment.py"), { "shop/payment.py": 1 });
  });

  it("keeps confirmations in its own storage, never in the repo, so a new store after a restart still knows them", async () => {
    await changes("shop/payment.py");
    commit({ "shop/payment.py": "v2\n" }, "Charge twice");
    const afterRestart = new ChangeMarkers(new ConfirmationStore(storage));
    assert.strictEqual((await afterRestart.check(repo, ["shop/payment.py"])).get("shop/payment.py")!.change!.commits, 1);
    assert.strictEqual(git(repo, "status", "--porcelain"), "", "nothing was written into the repo");
    assert.strictEqual(fs.readdirSync(storage).length, 1);
  });

  it("reads a path with brackets as a file name, not as a pattern", async () => {
    await changes("app/[id]/page.tsx");
    commit({ "app/i/page.tsx": "a file the pattern [id] would match\n" }, "Add a look-alike");
    assert.deepStrictEqual(await changes("app/[id]/page.tsx"), { "app/[id]/page.tsx": "none" });
    commit({ "app/[id]/page.tsx": "v2\n" }, "Change the page");
    assert.deepStrictEqual(await changes("app/[id]/page.tsx"), { "app/[id]/page.tsx": 1 });
  });

  it("marks an entry whose confirmed commit is gone, without a count", async () => {
    new ConfirmationStore(storage).confirm(repo, "shop/payment.py", "0123456789abcdef0123456789abcdef01234567");
    assert.deepStrictEqual(await changes("shop/payment.py"), { "shop/payment.py": undefined });
  });

  it("has no marks outside a git repo or before the first commit", async () => {
    const plainFolder = makeTempDir("markers-plain");
    assert.strictEqual((await markers.check(plainFolder, ["a.py"])).size, 0);
    git(plainFolder, "init", "--quiet");
    assert.strictEqual((await markers.check(plainFolder, ["a.py"])).size, 0);
    fs.rmSync(plainFolder, { recursive: true, force: true });
  });

  it("knows when a commit last touched a path, to tell whether an explanation is older", async () => {
    const before = (await markers.check(repo, ["shop/payment.py", "never/committed.py"]));
    assert.ok(before.get("shop/payment.py")!.lastCommitTime instanceof Date);
    assert.strictEqual(before.get("never/committed.py")!.lastCommitTime, undefined);

    const lastCommit = new Date(2026, 9, 7, 12, 0);
    assert.strictEqual(isExplanationOlder(new Date(2026, 9, 7, 11, 0), lastCommit), true);
    assert.strictEqual(isExplanationOlder(new Date(2026, 9, 7, 13, 0), lastCommit), false);
    assert.strictEqual(isExplanationOlder(new Date(2026, 9, 7, 13, 0), undefined), false);
  });

  it("says how many commits changed the path", () => {
    assert.strictEqual(changeText({ commits: 1 }), "Changed since you confirmed it (1 commit)");
    assert.strictEqual(changeText({ commits: 3 }), "Changed since you confirmed it (3 commits)");
    assert.strictEqual(changeText({ commits: undefined }), "Changed since you confirmed it (the confirmed commit is gone)");
  });
});
