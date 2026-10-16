import * as assert from "assert";
import { CodemapEntry } from "../../src/codemap/codemap";
import { GodFileItem } from "../../src/godfiles/godFiles";
import { breadthText, contradictsCodemap, godFileTooltip, numbersLine } from "../../src/ui/godFileText";

const broad: GodFileItem = {
  path: "src/shop/checkout.py",
  codeLines: 1176,
  namesUsedOutside: Array.from({ length: 23 }, (_, index) => `name${index}`),
  filesUsingIt: Array.from({ length: 41 }, (_, index) => `src/user${index}.py`),
  commits: 66,
  coChangeAreas: Array.from({ length: 9 }, (_, index) => `area${index}`),
  score: 0.9,
  hint: "god file?",
};

const unknownBreadth: GodFileItem = { ...broad, path: "cmd/main.go", namesUsedOutside: undefined, filesUsingIt: undefined, hint: undefined };

describe("G5: what the God Files view says about a file", () => {
  it("G5: shows the numbers line", () => {
    assert.strictEqual(numbersLine(broad), "23 names used by 41 files · 66 commits/90 d · changes with 9 areas · 1,176 lines");
    assert.strictEqual(numbersLine({ ...broad, namesUsedOutside: ["a"], filesUsingIt: ["b"], coChangeAreas: ["c"], commits: 1 }), "1 name used by 1 file · 1 commit/90 d · changes with 1 area · 1,176 lines");
  });

  it("G3, G5: shows unknown breadth as \"–\", never as 0", () => {
    assert.strictEqual(breadthText(unknownBreadth), "– names used outside");
    assert.ok(!numbersLine(unknownBreadth).includes(" 0 names"));
    const tooltip = godFileTooltip({ item: unknownBreadth, entry: undefined, actions: [] });
    assert.ok(tooltip.includes("– names used outside:** breadth is measured for TypeScript, JavaScript and Python only"), tooltip);
  });

  it("G5: the tooltip says what each number means and the owner's rule", () => {
    const tooltip = godFileTooltip({ item: broad, entry: undefined, actions: [{ title: "Open", link: "command:x" }] });
    const shown = unescaped(tooltip);
    for (const part of ["**23 names used by 41 files:**", "**66 commits in 90 days:**", "**Changes with 9 areas**", "never part of the score", "A big file is fine only as a well-designed deep module", "[Open](command:x)"]) {
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

// The tooltip as a reader sees it: Markdown's backslash escapes removed.
function unescaped(markdown: string): string {
  return markdown.replace(/\\(.)/g, "$1");
}
