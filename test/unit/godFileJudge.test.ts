import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { checkedJudgment, GodFileJudges } from "../../src/analysis/godFileJudge";
import { claudeRunner, RunClaude } from "../../src/claude/claudeCli";
import { godFileJudgeSchema } from "../../src/claude/schemas";
import { defaultGodFileOptions, GodFileReport, measureGodFiles } from "../../src/godfiles/godFiles";
import { fingerprint, makeTempDir } from "../support/gitFixture";
import { commitFilesAt, filler, initRepo } from "../support/historyFixture";

const root = path.resolve(__dirname, "..", "..", "..");
const fakeClaudePath = path.join(root, "test", "fixtures", "fake-claude.js");

const broadFile = Array.from({ length: 12 }, (_, index) => `export function broad${index + 1}(): void {\n${filler(14, `step${index}`)}\n}\n`).join("\n");

interface FakeLogEntry {
  pass: string;
  cwd: string;
  readableFolders: string[];
  args: string[];
}

describe("G7: Judge with Claude", () => {
  let scratch: string;
  let repo: string;
  let storage: string;
  let report: GodFileReport;
  let logFile: string;

  before(async () => {
    scratch = makeTempDir("godfiles-judge");
    repo = path.join(scratch, "repo");
    storage = path.join(scratch, "storage");
    logFile = path.join(scratch, "claude.log");
    initRepo(repo);
    commitFilesAt(repo, 50, { "src/shop/broad.ts": broadFile, "apps/web/page.ts": "import { broad1, broad2 } from '../../src/shop/broad';\n", ".gitignore": ".env\n/.codemap/\n" }, "Add the broad file");
    commitFilesAt(repo, 20, { "src/shop/broad.ts": `${broadFile}// prices\n` }, "Fix rounding of prices");
    fs.writeFileSync(path.join(repo, ".env"), "API_KEY=secret\n");
    fs.mkdirSync(path.join(repo, ".codemap"));
    fs.writeFileSync(path.join(repo, ".codemap", "codemap.yaml"), "- path: src/shop/broad.ts\n  says: x\n  label: core\n");
    fs.writeFileSync(path.join(repo, "untracked.ts"), "export const draft = 1;\n");
    report = await measureGodFiles(repo, defaultGodFileOptions);
    process.env.FAKE_CLAUDE_LOG = logFile;
  });

  after(() => {
    delete process.env.FAKE_CLAUDE_LOG;
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  function judges(runClaude: RunClaude) {
    return new GodFileJudges({ storageFolder: storage, runClaude, language: () => "German" });
  }

  it("G7, S1: runs once, read-only, in a copy of HEAD with the commit subjects and the numbers as files, and changes no byte of the repo", async () => {
    const before = fingerprint(repo);
    const item = report.items.find((candidate) => candidate.path === "src/shop/broad.ts")!;
    const stored = await judges(claudeRunner(() => ({ executable: fakeClaudePath, model: "haiku" }))).judge(repo, item, report);

    const calls = fs.readFileSync(logFile, "utf8").trim().split("\n").map((line) => JSON.parse(line) as FakeLogEntry);
    assert.strictEqual(calls.length, 1);
    const [call] = calls;
    assert.strictEqual(call.pass, "god file judge");
    assert.ok(call.cwd.startsWith(path.join(storage, "head-copies")), `Claude runs in the HEAD copy, not the repo: ${call.cwd}`);
    assert.ok(call.cwd.endsWith(report.commit));
    assert.deepStrictEqual(fs.readdirSync(call.cwd).sort(), [".gitignore", "apps", "src"], "tracked files only: no .env, no untracked file, no .codemap");
    for (const flag of ["--restricted", "--strict-mcp-config", "--no-session-persistence"]) {
      assert.ok(call.args.includes(flag), `${flag} is set`);
    }
    assert.strictEqual(call.args[call.args.indexOf("--tools") + 1], "Read,Grep,Glob");
    assert.strictEqual(call.args[call.args.indexOf("--permission-mode") + 1], "dontAsk");
    assert.strictEqual(call.readableFolders.length, 1);
    const context = call.readableFolders[0];
    assert.ok(context.startsWith(path.join(storage, "god-file-context")));
    const history = fs.readFileSync(path.join(context, "history.txt"), "utf8");
    assert.ok(history.includes("Fix rounding of prices") && history.includes("Add the broad file"), history);
    const numbers = fs.readFileSync(path.join(context, "numbers.txt"), "utf8");
    assert.ok(numbers.includes("names used by other files (2): broad1, broad2"), numbers);
    assert.ok(numbers.includes("commits in 90 days: 2"), numbers);

    assert.strictEqual(stored.judgment.verdict, "god_file");
    assert.strictEqual(stored.commit, report.commit);
    assert.strictEqual(fingerprint(repo), before, "no byte in the repo changed");
  });

  it("G7: keeps the judgment per file and HEAD commit, and never asks Claude on its own", async () => {
    let calls = 0;
    const counting: RunClaude = async <T>() => {
      calls++;
      throw new Error("must not run") as unknown as T;
    };
    const quiet = judges(counting);
    const stored = quiet.judgmentOf(repo, "src/shop/broad.ts", report.commit);
    assert.strictEqual(stored?.judgment.verdict, "god_file", "the judgment of the first test is found again");
    assert.strictEqual(quiet.judgmentOf(repo, "src/shop/broad.ts", "0".repeat(40)), undefined, "another commit has no judgment");
    assert.strictEqual(quiet.judgmentOf(repo, "apps/web/page.ts", report.commit), undefined);
    assert.strictEqual(calls, 0);
  });

  it("G7: refuses to judge when HEAD moved after the measurement", async () => {
    const item = report.items[0];
    const old = { ...report, commit: "1".repeat(40) };
    await assert.rejects(judges(claudeRunner(() => ({ executable: fakeClaudePath, model: "haiku" }))).judge(repo, item, old), /HEAD moved since the god files were measured/);
  });

  it("G7: checks the answer against the schema and drops lines that are not in the file", () => {
    const answer = validAnswer();
    const judgment = checkedJudgment(answer, 10);
    assert.deepStrictEqual(judgment.readingPath.map((step) => step.line), [1, undefined, 3]);
    assert.deepStrictEqual(judgment.responsibilities.map((part) => [part.startLine, part.endLine]), [[1, 4], [5, undefined]]);
    assert.throws(() => checkedJudgment({ ...answer, verdict: "fine" }, 10), /verdict is not one of god_file, deep_module, hub, ok/);
    assert.throws(() => checkedJudgment({ ...answer, readingPath: [{ name: 7, line: 1, why: "x" }] }, 10), /a step's name is not a text/);
    assert.throws(() => checkedJudgment("I would rather not.", 10), /not an object/);
    assert.deepStrictEqual(godFileJudgeSchema.properties.verdict.enum, ["god_file", "deep_module", "hub", "ok"]);
  });
});

function validAnswer() {
  return {
    verdict: "god_file",
    verdictWhy: "It does <script>alert(1)</script> three jobs.",
    responsibilities: [{ name: "Pricing", startLine: 1, endLine: 4 }, { name: "Shipping", startLine: 5, endLine: 99999 }],
    readingPath: [{ name: "broad1", line: 1, why: "Start." }, { name: "broad5", line: 99999, why: "Gone." }, { name: "broad9", line: 3, why: "[x](javascript:alert(1))" }],
    keepOrSplit: { decision: "split", why: "Three reasons: pricing.ts takes broad1 to broad4." },
  };
}
