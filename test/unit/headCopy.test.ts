import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { HeadCopies } from "../../src/git/headCopy";
import { fingerprint, git, makeTempDir } from "../support/gitFixture";

describe("the HEAD copy that Claude reads (C10)", () => {
  let scratch: string;
  let repo: string;
  let storage: string;

  beforeEach(() => {
    scratch = makeTempDir("head-copy");
    repo = path.join(scratch, "repo");
    storage = path.join(scratch, "storage");
    fs.mkdirSync(repo);
    git(repo, "init", "--quiet", "--initial-branch=main");
  });

  afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  function write(files: Record<string, string>): void {
    for (const [filePath, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(repo, filePath)), { recursive: true });
      fs.writeFileSync(path.join(repo, filePath), content);
    }
  }

  function commit(message: string): void {
    git(repo, "add", "--all");
    git(repo, "commit", "--quiet", "-m", message);
  }

  it("C10: the HEAD copy holds every tracked file at HEAD and nothing else, and the repo stays byte for byte the same", async () => {
    write({ "shop/payment.py": "v1\n", "shop/cart/cart.py": "cart\n", ".gitignore": ".env\n/.codemap/\n" });
    fs.mkdirSync(path.join(scratch, "outside"));
    fs.writeFileSync(path.join(scratch, "outside", "secret.txt"), "outside the repo\n");
    fs.symlinkSync("cart/cart.py", path.join(repo, "shop", "inside-link.py"));
    fs.symlinkSync("../../outside/secret.txt", path.join(repo, "shop", "outside-link.txt"));
    fs.symlinkSync(path.join(scratch, "outside", "secret.txt"), path.join(repo, "shop", "absolute-link"));
    commit("Start the shop");
    // A page committed by mistake into the personal folder must not reach Claude either.
    write({ ".codemap/explanations/shop/index.html": "<h1>The answer</h1>\n" });
    git(repo, "add", "--force", ".codemap");
    git(repo, "commit", "--quiet", "-m", "Commit the codemap folder by mistake");
    write({ ".env": "API_KEY=secret\n", "untracked.py": "new\n", "shop/payment.py": "v2, not committed\n" });
    const before = fingerprint(repo);

    const copy = await new HeadCopies(storage).copyOf(repo);

    assert.strictEqual(copy.commit, git(repo, "rev-parse", "HEAD"));
    assert.ok(copy.folder.startsWith(storage + path.sep), "the copy is in the extension's storage");
    assert.deepStrictEqual(filesIn(copy.folder), [".gitignore", "shop/cart/cart.py", "shop/inside-link.py", "shop/payment.py"]);
    assert.strictEqual(fs.readFileSync(path.join(copy.folder, "shop", "payment.py"), "utf8"), "v1\n", "the committed text, not the edit");
    assert.strictEqual(fs.readFileSync(path.join(copy.folder, "shop", "inside-link.py"), "utf8"), "cart\n", "a link that stays inside still works");
    assert.strictEqual(fingerprint(repo), before, "no byte in the repo (or its .git) changed");
  });

  it("reuses the copy while HEAD stays, and keeps the copies of the two newest commits", async () => {
    const copies = new HeadCopies(storage);
    write({ "a.py": "1\n" });
    commit("One");
    const first = await copies.copyOf(repo);
    fs.writeFileSync(path.join(first.folder, "marker"), "");
    assert.strictEqual((await copies.copyOf(repo)).folder, first.folder);
    assert.ok(fs.existsSync(path.join(first.folder, "marker")), "not written again");

    for (const text of ["2\n", "3\n"]) {
      write({ "a.py": text });
      commit(`Write ${text.trim()}`);
      await copies.copyOf(repo);
    }
    const kept = fs.readdirSync(path.dirname(first.folder));
    assert.strictEqual(kept.length, 2, kept.join(", "));
    assert.ok(!kept.includes(path.basename(first.folder)), "the oldest copy is gone");
  });

  it("C10: refuses a partial clone, because copying HEAD would fetch into its .git", async () => {
    write({ "a.py": "1\n" });
    commit("One");
    git(repo, "config", "remote.origin.promisor", "true");
    await assert.rejects(new HeadCopies(storage).copyOf(repo), /partial clone/);
    assert.ok(!fs.existsSync(storage) || filesIn(storage).length === 0, "nothing was copied");
  });

  it("says so when there is no commit yet", async () => {
    await assert.rejects(new HeadCopies(storage).copyOf(repo), /no commit yet/);
  });
});

function filesIn(folder: string, prefix = ""): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(path.join(folder, prefix), { withFileTypes: true })) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...filesIn(folder, relative));
    } else {
      files.push(relative);
    }
  }
  return files.sort();
}
