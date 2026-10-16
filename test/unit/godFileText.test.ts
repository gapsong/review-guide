import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { CodemapEntry } from "../../src/codemap/codemap";
import { defaultGodFileOptions, GodFileItem, GodFileReport } from "../../src/godfiles/godFiles";
import { GodFileReportCache } from "../../src/godfiles/reportCache";
import { breadthText, contradictsCodemap, godFileTooltip, numbersLine, rankReason } from "../../src/ui/godFileText";
import { makeTempDir } from "../support/gitFixture";

const broad: GodFileItem = {
  path: "src/shop/checkout.py",
  codeLines: 1176,
  namesUsedOutside: Array.from({ length: 23 }, (_, index) => `name${index}`),
  filesUsingIt: Array.from({ length: 41 }, (_, index) => `src/user${index}.py`),
  commitsInWindow: 66,
  commitsInRecentDays: 20,
  coChangePartners: ["apps/a/x.py", "apps/b/y.py"],
  coChangeAreas: Array.from({ length: 9 }, (_, index) => `area${index}`),
  score: 0.9,
  percentiles: { namesUsedOutside: 1, coChangeAreas: 0.9, commitsInWindow: 0.8, coChangePartners: 0.9 },
  hint: "god file?",
};

const unknownBreadth: GodFileItem = { ...broad, path: "cmd/main.go", namesUsedOutside: undefined, filesUsingIt: undefined, hint: undefined, percentiles: { coChangeAreas: 0.5, commitsInWindow: 0.5, coChangePartners: 0.5 } };

const report: GodFileReport = { commit: "abc", days: 90, minCodeLines: 150, sourceFileCount: 10, commitCount: 70, items: [broad, unknownBreadth] };

describe("G5: what the God Files view says about a file", () => {
  it("G5: shows the numbers line", () => {
    assert.strictEqual(numbersLine(broad, 90), "23 names used by 41 files · 66 commits/90 d · changes with 9 areas · 1,176 lines");
    assert.strictEqual(numbersLine({ ...broad, namesUsedOutside: ["a"], filesUsingIt: ["b"], coChangeAreas: ["c"] }, 30), "1 name used by 1 file · 66 commits/30 d · changes with 1 area · 1,176 lines");
  });

  it("G3, G5: shows unknown breadth as \"–\", never as 0", () => {
    assert.strictEqual(breadthText(unknownBreadth), "– names used outside");
    assert.ok(!numbersLine(unknownBreadth, 90).includes(" 0 names"));
    const tooltip = godFileTooltip({ item: unknownBreadth, report, rank: 2, entry: undefined, actions: [] });
    assert.ok(tooltip.includes("– names used outside:** breadth is measured for TypeScript, JavaScript and Python only"), tooltip);
    assert.ok(!rankReason(unknownBreadth).includes("names used outside"), "the score leaves the unknown signal out");
  });

  it("G5: the tooltip says what each number means, the owner's rule and why the file ranks here", () => {
    const tooltip = godFileTooltip({ item: broad, report, rank: 1, entry: undefined, actions: [{ title: "Open", link: "command:x" }] });
    const shown = unescaped(tooltip);
    for (const part of ["**23 names used by 41 files:**", "**66 commits in 90 days** (20 in the last 30)", "**Changes with 2 other files in 9 areas**", "never part of the score",
      "**Why it ranks #1 of 2:** ahead of 100% on names used outside, 90% on co-change areas, 80% on commits, 90% on co-change partners", "A big file is fine only as a well-designed deep module", "[Open](command:x)"]) {
      assert.ok(shown.includes(part), `${part}\n---\n${tooltip}`);
    }
  });

  it("G6: shows the codemap label and warns when the codemap says deep but the file measures broad", () => {
    const deepEntry: CodemapEntry = { path: broad.path, says: "Checks out.", label: "money", deep: true };
    const tooltip = godFileTooltip({ item: broad, report, rank: 1, entry: deepEntry, actions: [] });
    assert.ok(tooltip.includes("$(warning) **Your codemap calls this file a deep module, but 23 of its names are used by other files** (more than 7)"), tooltip);
    assert.ok(unescaped(tooltip).includes("Codemap: 💰\u2009🧠 Checks out. *(money · deep module)*"), tooltip);
    assert.strictEqual(contradictsCodemap(broad, deepEntry), true);
    assert.strictEqual(contradictsCodemap(broad, { ...deepEntry, deep: false }), false);
    assert.strictEqual(contradictsCodemap({ ...broad, namesUsedOutside: ["a", "b", "c", "d", "e", "f", "g"] }, deepEntry), false, "7 names are not broad");
    assert.strictEqual(contradictsCodemap(unknownBreadth, deepEntry), false, "unknown breadth never contradicts");
    assert.ok(!godFileTooltip({ item: broad, report, rank: 1, entry: { ...deepEntry, deep: false }, actions: [] }).includes("$(warning)"));
  });

  it("G5: a path from the repo cannot become a link in the tooltip", () => {
    const tooltip = godFileTooltip({ item: { ...broad, path: "src/[x](command:evil).py" }, report, rank: 1, entry: undefined, actions: [] });
    assert.ok(!tooltip.includes("](command:evil)"), tooltip);
  });
});

describe("G5: the report cache in the extension's storage", () => {
  let scratch: string;

  before(() => {
    scratch = makeTempDir("godfiles-cache");
  });

  after(() => fs.rmSync(scratch, { recursive: true, force: true }));

  it("G5: keeps one report per repo, HEAD commit and settings, and the newest few only", () => {
    const cache = new GodFileReportCache(path.join(scratch, "storage"));
    const repo = path.join(scratch, "repo");
    assert.strictEqual(cache.reportOf(repo, "abc", defaultGodFileOptions), undefined);
    cache.save(repo, report, defaultGodFileOptions);
    // JSON leaves an unknown breadth out, and reading it back gives undefined again.
    assert.deepStrictEqual(cache.reportOf(repo, "abc", defaultGodFileOptions), JSON.parse(JSON.stringify(report)));
    assert.strictEqual(cache.reportOf(repo, "abc", defaultGodFileOptions)!.items[1].namesUsedOutside, undefined);
    assert.strictEqual(cache.reportOf(repo, "abc", { ...defaultGodFileOptions, days: 30 }), undefined, "other settings, other report");
    assert.strictEqual(cache.reportOf(repo, "def", defaultGodFileOptions), undefined, "another commit, another report");
    for (const commit of ["c1", "c2", "c3", "c4", "c5"]) {
      cache.save(repo, { ...report, commit }, defaultGodFileOptions);
    }
    const files = fs.readdirSync(path.join(scratch, "storage", fs.readdirSync(path.join(scratch, "storage"))[0]));
    assert.strictEqual(files.length, 4);
  });
});

// The tooltip as a reader sees it: Markdown's backslash escapes removed.
function unescaped(markdown: string): string {
  return markdown.replace(/\\(.)/g, "$1");
}
