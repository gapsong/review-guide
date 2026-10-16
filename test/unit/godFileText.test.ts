import * as assert from "assert";
import { checkedJudgment } from "../../src/analysis/godFileJudge";
import { CodemapEntry } from "../../src/codemap/codemap";
import { GodFileItem } from "../../src/godfiles/godFiles";
import { renderExplainPanel } from "../../src/ui/explainHtml";
import { contradictsCodemap, godFileTooltip, judgeHtml, judgeStyles, numbersLine } from "../../src/ui/godFileText";

const broad: GodFileItem = {
  path: "src/shop/checkout.py",
  codeLines: 1176,
  namesUsedOutside: Array.from({ length: 23 }, (_, index) => `name${index}`),
  commits: 66,
  coChangeAreas: Array.from({ length: 9 }, (_, index) => `area${index}`),
  score: 0.9,
  hint: "god file?",
};

const unknownBreadth: GodFileItem = { ...broad, path: "cmd/main.go", namesUsedOutside: undefined, hint: undefined };

describe("G5: what the God Files view says about a file", () => {
  it("G5: shows the numbers line", () => {
    assert.strictEqual(numbersLine(broad), "23 names used outside · 66 commits/90 d · changes with 9 areas · 1,176 lines");
    assert.strictEqual(numbersLine({ ...broad, namesUsedOutside: ["a"], coChangeAreas: ["c"], commits: 1 }), "1 name used outside · 1 commit/90 d · changes with 1 area · 1,176 lines");
  });

  it("G3, G5: shows unknown breadth as \"–\", never as 0", () => {
    assert.ok(numbersLine(unknownBreadth).startsWith("– names used outside · "), numbersLine(unknownBreadth));
    const tooltip = godFileTooltip({ item: unknownBreadth, entry: undefined, actions: [] });
    assert.ok(tooltip.includes("– names used outside:** breadth is measured for TypeScript, JavaScript and Python only"), tooltip);
  });

  it("G5: the tooltip says what each number means and the owner's rule", () => {
    const tooltip = godFileTooltip({ item: broad, entry: undefined, actions: [{ title: "Open", link: "command:x" }] });
    const shown = unescaped(tooltip);
    for (const part of ["**23 names used outside:**", "**66 commits in 90 days:**", "**Changes with 9 areas**", "never part of the score", "A big file is fine only as a well-designed deep module", "[Open](command:x)"]) {
      assert.ok(shown.includes(part), `${part}\n---\n${tooltip}`);
    }
  });

  it("G6: shows the codemap label and warns when the codemap says deep but the file measures broad", () => {
    const deepEntry: CodemapEntry = { path: broad.path, says: "Checks out.", label: "money", deep: true };
    const tooltip = godFileTooltip({ item: broad, entry: deepEntry, actions: [] });
    assert.ok(tooltip.includes("$(warning) **Your codemap calls this file a deep module, but 23 of its names are used by other files** (more than 7)"), tooltip);
    assert.ok(unescaped(tooltip).includes("Codemap: 💰\u2009🧠 Checks out. *(money · deep module)*"), tooltip);
    assert.strictEqual(contradictsCodemap(broad, deepEntry), true);
    assert.strictEqual(contradictsCodemap(broad, { ...deepEntry, deep: false }), false);
    assert.strictEqual(contradictsCodemap({ ...broad, namesUsedOutside: ["a", "b", "c", "d", "e", "f", "g"] }, deepEntry), false, "7 names are not broad");
    assert.strictEqual(contradictsCodemap(unknownBreadth, deepEntry), false, "unknown breadth never contradicts");
    assert.ok(!godFileTooltip({ item: broad, entry: { ...deepEntry, deep: false }, actions: [] }).includes("$(warning)"));
  });

  it("G5: a path from the repo cannot become a link in the tooltip", () => {
    const tooltip = godFileTooltip({ item: { ...broad, path: "src/[x](command:evil).py" }, entry: undefined, actions: [] });
    assert.ok(!tooltip.includes("](command:evil)"), tooltip);
  });
});

describe("G7: the Judge view of the Explain panel", () => {
  const judgment = checkedJudgment({
    verdict: "god_file",
    verdictWhy: "It does <script>alert(1)</script> three jobs.",
    responsibilities: [{ name: "Pricing", startLine: 1, endLine: 4 }, { name: "Shipping", startLine: 5, endLine: 99999 }],
    readingPath: [{ name: "broad1", line: 1, why: "Start." }, { name: "broad5", line: 99999, why: "Gone." }, { name: "<b>broad9</b>", line: 3, why: "[x](javascript:alert(1))" }],
    keepOrSplit: { decision: "split", why: "Three reasons." },
  }, 10);
  const stored = { path: broad.path, commit: "a".repeat(40), judgment, judgedAt: "2026-10-16T12:00:00Z", durationMilliseconds: 61000 };
  const header = { path: broad.path, entry: undefined, hasExplanation: false, explanationOlder: false, change: undefined, otherPage: undefined, mode: "judge" as const, canJudge: true };
  const panel = (model: Parameters<typeof judgeHtml>[0]) => renderExplainPanel(header, "NONCE123", "vscode-resource:", judgeHtml(model), judgeStyles);

  it("G7: escapes every text of the judgment, runs only its nonce script, and links only to checked lines of the file", () => {
    const html = panel({ item: broad, commit: stored.commit, stored, judging: false });
    assert.ok(html.includes("script-src 'nonce-NONCE123'") && html.includes("default-src 'none'"));
    assert.strictEqual((html.match(/<script/g) ?? []).length, 1, "only the panel's own script");
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;") && html.includes("&lt;b&gt;broad9&lt;/b&gt;"));
    assert.ok(!/href=/.test(html), "no link target at all");
    const messages = [...html.matchAll(/data-review-guide="([^"]*)"/g)].map((match) => JSON.parse(match[1].replace(/&quot;/g, "\"")));
    assert.deepStrictEqual(messages.filter((message) => message.type === "openLine").map((message) => message.line), [1, 5, 1, 3], "the lines outside the file have no link");
    assert.ok(html.includes("Judge again") && html.includes("⚖️ Judge"));
  });

  it("G7: offers the run before the first judgment and shows it running", () => {
    assert.ok(panel({ item: broad, commit: stored.commit, stored: undefined, judging: false }).includes(">Judge with Claude</button>"));
    assert.ok(panel({ item: broad, commit: stored.commit, stored: undefined, judging: true }).includes(" disabled data-review-guide"));
  });
});

// The tooltip as a reader sees it: Markdown's backslash escapes removed.
function unescaped(markdown: string): string {
  return markdown.replace(/\\(.)/g, "$1");
}
