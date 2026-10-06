import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { badgeOf, tooltipOf } from "../../src/codemap/badge";
import { CodemapEntry, parseCodemap, startLocationOf } from "../../src/codemap/codemap";
import { explanationFolderOf, explanationPageOf } from "../../src/codemap/explanationFiles";
import { cleanRelativePath, repoPathOf } from "../../src/codemap/repoPath";

const fixturePath = path.resolve(__dirname, "..", "..", "..", "test", "fixtures", "codemap.yaml");
const everyPathExists = () => true;

function problemsOf(text: string, pathExists: (repoPath: string) => boolean = everyPathExists): [number, string][] {
  return parseCodemap(text, pathExists).problems.map((problem) => [problem.line, problem.message]);
}

describe("C1, C2: reading the codemap", () => {
  it("reads a whole codemap: every entry, with its sentence, label and deep flag", () => {
    const codemap = parseCodemap(fs.readFileSync(fixturePath, "utf8"), everyPathExists);
    assert.deepStrictEqual(codemap.problems, []);
    assert.strictEqual(codemap.entries.length, 10);
    assert.deepStrictEqual(codemap.entries[2], {
      path: "shop/checkout/payment.py",
      says: "The only way to the payment provider. It reserves the amount first, then charges it, then writes the receipt with the final price.",
      label: "money",
      deep: true,
    });
    assert.strictEqual(codemap.entries[1].deep, false, "deep is false when it is left out");
  });

  it("reports a path that does not exist on its line, and still keeps the entry", () => {
    const text = "- path: src/a.py\n  says: A.\n  label: core\n\n- path: src/gone.py\n  says: Gone.\n  label: util\n";
    const codemap = parseCodemap(text, (repoPath) => repoPath !== "src/gone.py");
    assert.deepStrictEqual(codemap.problems, [{ line: 5, message: "path does not exist (moved or deleted?)" }]);
    assert.deepStrictEqual(codemap.entries.map((entry) => entry.path), ["src/a.py", "src/gone.py"]);
  });

  it("reports an unknown key on its line and skips the entry", () => {
    const text = "- path: src/a.py\n  says: A.\n  label: core\n  owner: me\n";
    assert.deepStrictEqual(problemsOf(text), [[4, "unknown key \"owner\" (allowed: path, says, label, deep, why, watch, start, mine)"]]);
    assert.deepStrictEqual(parseCodemap(text, everyPathExists).entries, []);
  });

  it("reports a label that is not one of the five and skips the entry", () => {
    const text = "- path: src/a.py\n  says: A.\n  label: important\n";
    assert.deepStrictEqual(problemsOf(text), [[3, "label \"important\" is not one of money, security, core, feature, util"]]);
    assert.deepStrictEqual(parseCodemap(text, everyPathExists).entries, []);
  });

  it("reports a deep that is not true or false (YAML reads yes as text) and skips the entry", () => {
    const text = "- path: src/a.py\n  says: A.\n  label: core\n  deep: yes\n";
    assert.deepStrictEqual(problemsOf(text), [[4, "deep must be true or false, not \"yes\""]]);
    assert.deepStrictEqual(parseCodemap(text, everyPathExists).entries, []);
  });

  it("reports an empty says and a says over 160 characters, counting umlauts once", () => {
    const empty = "- path: src/a.py\n  says:\n  label: core\n";
    assert.deepStrictEqual(problemsOf(empty), [[2, "says is empty"]]);
    const exactly160 = "ä".repeat(160);
    assert.deepStrictEqual(problemsOf(`- path: src/a.py\n  says: ${exactly160}\n  label: core\n`), []);
    const tooLong = `- path: src/a.py\n  label: core\n  says: ${exactly160}ö\n`;
    assert.deepStrictEqual(problemsOf(tooLong), [[3, "says is 161 characters long (at most 160)"]]);
    assert.deepStrictEqual(parseCodemap(tooLong, everyPathExists).entries, []);
  });

  it("reports the second entry of a path that is listed twice, and keeps the first", () => {
    const text = "- path: src/a.py\n  says: First.\n  label: core\n\n- path: ./src/a.py/\n  says: Second.\n  label: util\n";
    assert.deepStrictEqual(problemsOf(text), [[5, "path is listed twice (first on line 1)"]]);
    assert.deepStrictEqual(parseCodemap(text, everyPathExists).entries.map((entry) => entry.says), ["First."]);
  });

  it("reports missing keys on the entry's first line", () => {
    const text = "# notes\n\n- says: No path.\n  label: core\n- path: src/b.py\n";
    assert.deepStrictEqual(problemsOf(text), [
      [3, "path is missing"],
      [5, "says is missing"],
      [5, "label is missing"],
    ]);
  });

  it("refuses a path that could leave the workspace folder", () => {
    const text = "- path: ../secrets\n  says: Outside.\n  label: util\n- path: /etc\n  says: Absolute.\n  label: util\n";
    const message = "path must be relative to the workspace folder, without \"..\" and without a leading \"/\"";
    assert.deepStrictEqual(problemsOf(text), [[1, message], [4, message]]);
  });

  it("reports every problem of an entry, and the other entries still count", () => {
    const text = "- path: src/a.py\n  says: A.\n  label: big\n  deep: 1\n- path: src/b.py\n  says: B.\n  label: util\n";
    assert.deepStrictEqual(problemsOf(text), [
      [3, "label \"big\" is not one of money, security, core, feature, util"],
      [4, "deep must be true or false, not \"1\""],
    ]);
    assert.deepStrictEqual(parseCodemap(text, everyPathExists).entries.map((entry) => entry.path), ["src/b.py"]);
  });

  it("reads the optional notes why, watch, start and mine, with mine over several lines", () => {
    const text = [
      "- path: shop/checkout/payment.py",
      "  says: Reserves the amount, then charges it.",
      "  label: money",
      "  why: A wrong amount is charged to a real card.",
      "  watch: The provider retries on timeout, so a charge must be idempotent.",
      "  start: shop/checkout/payment.py:42",
      "  mine: |",
      "    First reserve, then charge.",
      "    The receipt is written last.",
      "",
    ].join("\n");
    const codemap = parseCodemap(text, everyPathExists);
    assert.deepStrictEqual(codemap.problems, []);
    assert.deepStrictEqual(codemap.entries[0], {
      path: "shop/checkout/payment.py",
      says: "Reserves the amount, then charges it.",
      label: "money",
      deep: false,
      why: "A wrong amount is charged to a real card.",
      watch: "The provider retries on timeout, so a charge must be idempotent.",
      start: "shop/checkout/payment.py:42",
      mine: "First reserve, then charge.\nThe receipt is written last.",
    });
  });

  it("reports a note that is empty, not text, too long, or on several lines when it must be one", () => {
    const entry = (note: string) => `- path: src/a.py\n  says: A.\n  label: core\n${note}`;
    assert.deepStrictEqual(problemsOf(entry("  why:\n")), [[4, "why is empty (leave it out instead)"]]);
    assert.deepStrictEqual(problemsOf(entry("  watch: 12\n")), [[4, "watch must be text"]]);
    assert.deepStrictEqual(problemsOf(entry(`  why: ${"a".repeat(301)}\n`)), [[4, "why is 301 characters long (at most 300)"]]);
    assert.deepStrictEqual(problemsOf(entry(`  watch: ${"ü".repeat(200)}\n`)), []);
    assert.deepStrictEqual(problemsOf(entry(`  mine: ${"a".repeat(1501)}\n`)), [[4, "mine is 1501 characters long (at most 1500)"]]);
    assert.deepStrictEqual(problemsOf(entry("  watch: |\n    one\n    two\n")), [[4, "watch must be one line (only mine may span several)"]]);
    assert.deepStrictEqual(parseCodemap(entry("  why:\n"), everyPathExists).entries, [], "an entry with a broken note gets no badge");
  });

  it("checks that start is a path in the workspace folder with an optional line, and that it exists", () => {
    const entry = (start: string) => `- path: src/a.py\n  says: A.\n  label: core\n  start: ${start}\n`;
    const message = "start must be a path in the workspace folder, optionally with a line, like \"src/app.py:120\"";
    assert.deepStrictEqual(problemsOf(entry("src/a.py:120")), []);
    assert.deepStrictEqual(problemsOf(entry("src/a.py")), []);
    assert.deepStrictEqual(problemsOf(entry("../a.py:3")), [[4, message]]);
    assert.deepStrictEqual(problemsOf(entry("src/a.py:0")), [[4, message]]);
    const moved = parseCodemap(entry("src/old.py:7"), (repoPath) => repoPath !== "src/old.py");
    assert.deepStrictEqual(moved.problems, [{ line: 4, message: "start points to a path that does not exist (moved or deleted?)" }]);
    assert.strictEqual(moved.entries.length, 1, "like a missing path, a missing start is only reported");
  });

  it("splits start into its path and line", () => {
    assert.deepStrictEqual(startLocationOf("src/x.py:120"), { path: "src/x.py", line: 120 });
    assert.deepStrictEqual(startLocationOf(" ./src/x.py "), { path: "src/x.py", line: undefined });
    assert.strictEqual(startLocationOf("/etc/passwd:1"), undefined);
  });

  it("reports broken YAML on its line and reads no entries from it", () => {
    const text = "- path: src/a.py\n  says: A: with a colon\n  label: core\n";
    const codemap = parseCodemap(text, everyPathExists);
    assert.deepStrictEqual(codemap.entries, []);
    assert.strictEqual(codemap.problems.length, 1);
    assert.strictEqual(codemap.problems[0].line, 2);
    assert.match(codemap.problems[0].message, /^YAML: /);
  });

  it("reports a file that is not a list, and reads an empty file as no entries and no problems", () => {
    assert.deepStrictEqual(problemsOf("# notes\npath: src/a.py\n"), [[2, "the codemap must be a list of entries, each starting with \"- path:\""]]);
    assert.deepStrictEqual(parseCodemap("# only notes so far\n", everyPathExists), { entries: [], problems: [] });
    assert.deepStrictEqual(parseCodemap("", everyPathExists), { entries: [], problems: [] });
  });
});

describe("C1: badge and tooltip in the Explorer", () => {
  const entry = (label: CodemapEntry["label"], deep: boolean): CodemapEntry => ({ path: "src/a.py", says: "Reserves the amount first.", label, deep });

  it("shows the label's emoji, and a brain as the second character for a deep module", () => {
    assert.strictEqual(badgeOf(entry("money", false)), "💰");
    assert.strictEqual(badgeOf(entry("security", false)), "🔒");
    assert.strictEqual(badgeOf(entry("core", false)), "⚙️");
    assert.strictEqual(badgeOf(entry("feature", false)), "🧩");
    assert.strictEqual(badgeOf(entry("util", false)), "🧰");
    assert.strictEqual(badgeOf(entry("money", true)), "💰🧠");
  });

  it("keeps every badge within the two characters VS Code allows", () => {
    const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
    for (const label of ["money", "security", "core", "feature", "util"] as const) {
      const badge = badgeOf(entry(label, true));
      assert.strictEqual([...segmenter.segment(badge)].length, 2, badge);
    }
  });

  it("shows the sentence, then the label, then deep module", () => {
    assert.strictEqual(tooltipOf(entry("money", false)), "Reserves the amount first. · money");
    assert.strictEqual(tooltipOf(entry("money", true)), "Reserves the amount first. · money · deep module");
  });
});

describe("C3: repo paths and where explanations live", () => {
  it("puts a path's explanation into its own folder under .codemap/explanations", () => {
    assert.strictEqual(explanationFolderOf("apps/api/main.py"), ".codemap/explanations/apps/api/main.py");
    assert.strictEqual(explanationPageOf("apps/api/main.py"), ".codemap/explanations/apps/api/main.py/index.html");
    assert.strictEqual(explanationPageOf("apps/api"), ".codemap/explanations/apps/api/index.html");
  });

  it("finds the repo path of a file in the workspace folder, and none outside it or for the folder itself", () => {
    const root = path.join(path.sep, "work", "shop");
    assert.strictEqual(repoPathOf(root, path.join(root, "apps", "api", "main.py")), "apps/api/main.py");
    assert.strictEqual(repoPathOf(root, path.join(root, "..shop-notes")), "..shop-notes");
    assert.strictEqual(repoPathOf(root, root), undefined);
    assert.strictEqual(repoPathOf(root, path.join(path.sep, "work", "other", "x.py")), undefined);
  });

  it("tidies a written path and refuses one that could leave its folder", () => {
    assert.strictEqual(cleanRelativePath(" ./apps/api/ "), "apps/api");
    assert.strictEqual(cleanRelativePath("steps/two.html"), "steps/two.html");
    for (const outside of ["", "/etc/passwd", "../x", "a/../../x", "a//b", "C:/x"]) {
      assert.strictEqual(cleanRelativePath(outside), undefined, outside);
    }
  });
});
