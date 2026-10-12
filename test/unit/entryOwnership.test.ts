import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { EntryChecks } from "../../src/analysis/entryCheck";
import { claudeRunner } from "../../src/claude/claudeCli";
import { ChangeMarkers, ConfirmationStore } from "../../src/codemap/changeMarkers";
import { CodemapEntry } from "../../src/codemap/codemap";
import {
  describeThreeAmCheck, EntryCheck, hashOfMine, nextToOwnOfAll, ownershipStateOf, OwnershipState, threeAmCheck,
} from "../../src/codemap/entryOwnership";
import { git, makeTempDir } from "../support/gitFixture";
import { fakeClaudePath, useFakeClaude } from "../support/testReviewGuide";

const payment: CodemapEntry = {
  path: "shop/payment.py",
  says: "Reserves the amount first, then charges it.",
  label: "money",
  deep: true,
  why: "A wrong amount is charged to a real card.",
  mine: "First a row is reserved, then the card is charged, and the receipt is written last.",
};

describe("owning a codemap entry: check my words, the tutor chat, the 3am check (C10-C13)", () => {
  let scratch: string;
  let repo: string;
  let storage: string;
  let markers: ChangeMarkers;
  let fakeClaude: ReturnType<typeof useFakeClaude>;

  beforeEach(() => {
    scratch = makeTempDir("entry-ownership");
    repo = path.join(scratch, "repo");
    storage = path.join(scratch, "storage");
    fs.mkdirSync(repo);
    git(repo, "init", "--quiet", "--initial-branch=main");
    commit({ "shop/payment.py": "def charge():\n    reserve()\n", "shop/cart.py": "cart\n", ".gitignore": "/.codemap/\n" }, "Start the shop");
    markers = new ChangeMarkers(new ConfirmationStore(path.join(storage, "codemap-confirmations")));
    fakeClaude = useFakeClaude(scratch, {});
    delete process.env.FAKE_CLAUDE_WATCH;
  });

  afterEach(() => {
    delete process.env.FAKE_CLAUDE_WATCH;
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  function commit(files: Record<string, string>, message: string): void {
    for (const [filePath, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(repo, filePath)), { recursive: true });
      fs.writeFileSync(path.join(repo, filePath), content);
    }
    git(repo, "add", "--all");
    git(repo, "commit", "--quiet", "-m", message);
  }

  function entryChecks(): EntryChecks {
    return new EntryChecks({
      storageFolder: storage,
      runClaude: claudeRunner(() => ({ executable: fakeClaudePath, model: "claude-opus-5-5" })),
      language: () => "English",
      confirmAt: (repoFolder, repoPath, commitSha) => markers.confirmAt(repoFolder, repoPath, commitSha),
      now: () => new Date("2026-10-09T18:40:00Z"),
    });
  }

  async function stateOf(checks: EntryChecks, entry: CodemapEntry): Promise<OwnershipState> {
    return (await checks.statesOf(repo, [entry])).get(entry.path)!;
  }

  async function changeOf(repoPath: string): Promise<number | undefined | "none"> {
    const change = (await markers.check(repo, [repoPath])).get(repoPath)!.change;
    return change ? change.commits : "none";
  }

  it("C10: grades mine in one read-only call on the HEAD copy and stores the verdict with the commit and the hash of mine", async () => {
    const head = git(repo, "rev-parse", "HEAD");
    const check = await entryChecks().check(repo, payment);

    assert.deepStrictEqual(check, {
      verdict: "understood",
      feedback: "Right, and it says why the order matters.",
      commit: head,
      mineHash: hashOfMine(payment.mine!),
      checkedAt: "2026-10-09T18:40:00.000Z",
      durationMilliseconds: 1200,
    });
    const calls = fakeClaude.calls();
    assert.strictEqual(calls.length, 1, "one call");
    assert.strictEqual(calls[0].pass, "entry check");
    assert.strictEqual(calls[0].cwd, path.join(storage, "head-copies", path.basename(path.dirname(calls[0].cwd)), head), "in the HEAD copy, in the extension's storage");
    assert.ok(fs.existsSync(path.join(calls[0].cwd, "shop", "payment.py")));
    const readable = calls[0].readableFolders;
    assert.strictEqual(readable.length, 1);
    assert.ok(readable[0].startsWith(path.join(storage, "entry-context")), "only the entry's context folder is readable besides the copy");
    assert.match(fs.readFileSync(path.join(readable[0], "history.txt"), "utf8"), /Start the shop/);

    const afterRestart = entryChecks();
    assert.deepStrictEqual(afterRestart.recordOf(repo, payment.path)!.check, check, "the verdict survives a new store");
    assert.strictEqual((await stateOf(afterRestart, payment)).kind, "owned");
    assert.strictEqual(git(repo, "status", "--porcelain", "--ignored"), "", "nothing was written into the repo");
  });

  it("C10: answers almost with a question and not yet with a file and line", async () => {
    const checks = entryChecks();
    const almost = await checks.check(repo, { ...payment, mine: "It partly reserves." });
    assert.strictEqual(almost.verdict, "almost");
    assert.match(almost.feedback, /\?$/);
    assert.strictEqual(almost.line, undefined);
    const notYet = await checks.check(repo, { ...payment, mine: "A cleanup resolves the row later, which is wrong." });
    assert.deepStrictEqual([notYet.verdict, notYet.file, notYet.line], ["not yet", "shop/payment.py", 2]);
    assert.strictEqual((await stateOf(checks, { ...payment, mine: "A cleanup resolves the row later, which is wrong." })).kind, "not yet");
  });

  it("C10: an entry without mine cannot be checked, and a changed mine is not checked any more", async () => {
    const checks = entryChecks();
    const withoutWords = { ...payment, mine: undefined };
    await assert.rejects(checks.check(repo, withoutWords), /has no words of yours yet: add "mine: \|"/);
    assert.strictEqual(fakeClaude.calls().length, 0, "no call without words");
    assert.strictEqual((await stateOf(checks, withoutWords)).kind, "no words");

    await checks.check(repo, payment);
    assert.strictEqual((await stateOf(checks, payment)).kind, "owned");
    assert.strictEqual((await stateOf(checks, { ...payment, mine: `${payment.mine} And a refund.` })).kind, "not checked");
  });

  it("C10: refuses an answer that is not a verdict with feedback, and stores nothing", async () => {
    // Prose that happened to parse as JSON: what readClaudeResult hands on when there is no structured answer.
    const prose = async <T,>() => ({ answer: { verdict: "<b>great</b>", feedback: 42 } as unknown as T, durationMilliseconds: 1, inputTokens: 0, outputTokens: 0 });
    const checks = new EntryChecks({
      storageFolder: storage,
      runClaude: prose,
      language: () => "English",
      confirmAt: () => undefined,
    });
    await assert.rejects(checks.check(repo, payment), /not a verdict with feedback/);
    await assert.rejects(checks.chat(repo, payment, "And a refund?"), /not a verdict with feedback/);
    assert.strictEqual(checks.recordOf(repo, payment.path), undefined, "nothing was stored");
  });

  it("C11: a chat turn sends the conversation so far, its verdict is only a hint, and the history survives a new store", async () => {
    const checks = entryChecks();
    const first = await checks.chat(repo, payment, "So the row stays open until a cleanup?");
    assert.deepStrictEqual(first, { verdict: "almost", feedback: "No: it is resolved at once.\n```\nopen ─► fail ─► resolve\n```" });
    const second = await checks.chat(repo, payment, "Got it: it is resolved at once.");
    assert.strictEqual(second.verdict, "understood");
    assert.deepStrictEqual(fakeClaude.calls().map((call) => [call.pass, ...call.unitIds]), [["entry chat", "turns-before:0"], ["entry chat", "turns-before:1"]]);

    assert.strictEqual((await stateOf(checks, payment)).kind, "not checked", "an understood chat does not make the entry understood");
    assert.strictEqual(await changeOf(payment.path), "none");

    const afterRestart = entryChecks();
    assert.deepStrictEqual(afterRestart.recordOf(repo, payment.path)!.conversation, [
      { speaker: "owner", text: "So the row stays open until a cleanup?" },
      { speaker: "claude", reply: first },
      { speaker: "owner", text: "Got it: it is resolved at once." },
      { speaker: "claude", reply: second },
    ]);
  });

  it("D1: the check of mine sees neither the chat nor the explanation page", async () => {
    const checks = entryChecks();
    process.env.FAKE_CLAUDE_WATCH = "CHAT-CANARY";
    await checks.chat(repo, payment, "Is it CHAT-CANARY that resolves the row?");
    const explanationPage = path.join(repo, ".codemap", "explanations", "shop", "payment.py", "index.html");
    fs.mkdirSync(path.dirname(explanationPage), { recursive: true });
    fs.writeFileSync(explanationPage, "<p>The answer: PAGE-CANARY</p>\n");

    await checks.check(repo, payment);

    const check = fakeClaude.calls().find((call) => call.pass === "entry check")!;
    assert.strictEqual(check.saw, false, "the chat is not in the check's prompt");
    assert.ok(!fs.existsSync(path.join(check.cwd, ".codemap")), "the explanation page is not in the copy Claude reads");
    const chat = fakeClaude.calls().find((call) => call.pass === "entry chat")!;
    assert.strictEqual(chat.saw, true, "the chat itself does get the conversation, so the canary would be seen");
  });

  it("C12: a commit that touches the path makes understood stale with its number of commits, an uncommitted edit does not, and a new check restores it", async () => {
    const checks = entryChecks();
    await checks.check(repo, payment);

    fs.writeFileSync(path.join(repo, "shop", "payment.py"), "uncommitted\n");
    assert.strictEqual((await stateOf(checks, payment)).kind, "owned", "an uncommitted edit is work in progress");
    git(repo, "checkout", "--quiet", "--", "shop/payment.py");
    commit({ "shop/cart.py": "cart v2\n" }, "Change another file");
    assert.strictEqual((await stateOf(checks, payment)).kind, "owned", "a commit that does not touch the path");

    commit({ "shop/payment.py": "def charge():\n    charge_twice()\n" }, "Charge twice");
    commit({ "shop/payment.py": "def charge():\n    charge_once()\n" }, "Charge once");
    const stale = await stateOf(checks, payment);
    assert.deepStrictEqual([stale.kind, stale.kind === "changed" && stale.commitsSince], ["changed", 2]);

    await checks.check(repo, payment);
    assert.strictEqual((await stateOf(checks, payment)).kind, "owned");
  });

  it("C12: a checked commit that no longer exists counts as changed without a number", async () => {
    const checks = entryChecks();
    await checks.check(repo, payment);
    const record = checks.recordOf(repo, payment.path)!;
    const gone: EntryCheck = { ...record.check!, commit: "0123456789abcdef0123456789abcdef01234567" };
    assert.deepStrictEqual(ownershipStateOf(payment, { ...record, check: gone }, "gone"), { kind: "changed", check: gone, commitsSince: "gone" });
  });

  it("C12: an understood check confirms the change marker at its commit, and Still true alone does not restore understood", async () => {
    const checks = entryChecks();
    assert.strictEqual(await changeOf(payment.path), "none", "the first look confirms HEAD");
    commit({ "shop/payment.py": "v2\n" }, "Charge twice");
    assert.strictEqual(await changeOf(payment.path), 1);

    await checks.check(repo, payment);
    assert.strictEqual(await changeOf(payment.path), "none", "the understood check confirmed the marker at the checked commit");

    commit({ "shop/payment.py": "v3\n" }, "Charge once");
    assert.strictEqual(await changeOf(payment.path), 1);
    await markers.confirm(repo, payment.path);
    assert.strictEqual(await changeOf(payment.path), "none", "Still true clears the marker");
    assert.strictEqual((await stateOf(checks, payment)).kind, "changed", "but the words are still not checked at this commit");

    await checks.check(repo, { ...payment, mine: "It partly reserves." });
    commit({ "shop/payment.py": "v4\n" }, "Charge again");
    assert.strictEqual(await changeOf(payment.path), 1, "an almost check confirms nothing");
  });

  it("C12: lists the commits and files that changed since the check", async () => {
    const checks = entryChecks();
    const folderEntry: CodemapEntry = { ...payment, path: "shop" };
    await checks.check(repo, folderEntry);
    const checked = git(repo, "rev-parse", "HEAD");
    commit({ "shop/cart.py": "cart v2\n" }, "Keep prices");
    commit({ "README.md": "outside\n" }, "Docs");
    const changes = (await checks.changesSinceCheck(repo, "shop"))!;
    assert.strictEqual(changes.checkedCommit, checked);
    assert.deepStrictEqual(changes.commits.map((line) => line.replace(/^\w+ /, "")), ["Keep prices"]);
    assert.deepStrictEqual(changes.files, ["shop/cart.py"]);
  });

  it("C13: counts the 3am check of money and security entries and names the next one to own in codemap order", () => {
    const entry = (repoPath: string, label: CodemapEntry["label"], deep = false): CodemapEntry => ({ path: repoPath, says: "x", label, deep });
    const entries = [
      entry("auth/session.py", "security"),
      entry("shop/payment.py", "money"),
      entry("shop/ledger.py", "money", true),
      entry("shop/refund.py", "money"),
      entry("shop/search.py", "feature", true),
      entry("auth/keys.py", "security"),
    ];
    const check = { verdict: "understood", feedback: "", commit: "c", mineHash: "h", checkedAt: "", durationMilliseconds: 0 } as EntryCheck;
    const states: Record<string, OwnershipState> = {
      "shop/payment.py": { kind: "owned", check, commitsSince: 0 },
      "shop/ledger.py": { kind: "changed", check, commitsSince: 2 },
      "shop/refund.py": { kind: "almost", check: { ...check, verdict: "almost" }, commitsSince: 0 },
      "auth/session.py": { kind: "no words" },
      "auth/keys.py": { kind: "owned", check, commitsSince: 0 },
      "shop/search.py": { kind: "not checked" },
    };
    const stateOfEntry = (candidate: CodemapEntry) => states[candidate.path];

    const threeAm = threeAmCheck(entries, stateOfEntry);
    assert.strictEqual(describeThreeAmCheck(threeAm), "3am 💰🔒: 2 of 5 owned · 1 changed · 1 almost · 1 not checked · next: ledger.py");
    assert.strictEqual(describeThreeAmCheck(threeAmCheck(entries, stateOfEntry, ["security"])), "3am 🔒: 1 of 2 owned · 1 not checked · next: session.py");
    assert.strictEqual(describeThreeAmCheck(threeAmCheck([entry("x.py", "util")], stateOfEntry)), undefined, "no money or security entry, no line");

    states["shop/ledger.py"] = { kind: "owned", check, commitsSince: 0 };
    states["shop/refund.py"] = { kind: "owned", check, commitsSince: 0 };
    assert.strictEqual(threeAmCheck(entries, stateOfEntry).next!.path, "auth/session.py", "money before security");
    states["auth/session.py"] = { kind: "owned", check, commitsSince: 0 };
    assert.strictEqual(describeThreeAmCheck(threeAmCheck(entries, stateOfEntry)), "3am 💰🔒: 5 of 5 owned");
    assert.strictEqual(nextToOwnOfAll(entries, stateOfEntry)!.path, "shop/search.py", "Own Next goes on to the deep modules");
  });
});
