import * as assert from "assert";
import { CodemapEntry } from "../../src/codemap/codemap";
import { codemapTooltip, dateOf, escapeMarkdown, TooltipContent } from "../../src/ui/codemapTooltip";

const payment: CodemapEntry = {
  path: "shop/checkout/payment.py",
  says: "Reserves the amount first, then charges it.",
  label: "money",
  deep: true,
};

function content(changes: Partial<TooltipContent> = {}): TooltipContent {
  return {
    name: "payment.py",
    entry: payment,
    status: { explanationWritten: undefined, explanationOlder: false, change: undefined },
    startLink: undefined,
    actions: [{ title: "Explain", link: "command:reviewGuide.codemap.explain?%5B%5D" }],
    ...changes,
  };
}

describe("the Codemap view's tooltip", () => {
  it("shows the badge and name, the sentence, the label, the explanation status and the actions", () => {
    assert.strictEqual(codemapTooltip(content()), [
      "💰\u2009🧠\u2002**payment\\.py**",
      "Reserves the amount first\\, then charges it\\.",
      "*money · deep module*",
      "No explanation yet.",
      "[Explain](command:reviewGuide.codemap.explain?%5B%5D)",
    ].join("\n\n"));
  });

  it("shows the notes that are written, mine as a quote with its lines kept, and start as a link", () => {
    const entry = { ...payment, why: "Real cards.", watch: "Retries.", start: "shop/checkout/payment.py:42", mine: "Reserve first.\n\nThen charge." };
    const tooltip = codemapTooltip(content({ entry, startLink: "command:reviewGuide.codemap.openStart?%5B%5D" }));
    assert.ok(tooltip.includes("\n\n**Why it matters:** Real cards\\.\n\n**Watch:** Retries\\.\n\n"), tooltip);
    assert.ok(tooltip.includes("**Start reading:** [shop\\/checkout\\/payment\\.py\\:42](command:reviewGuide.codemap.openStart?%5B%5D)"), tooltip);
    assert.ok(tooltip.includes("**In your words:**\n\n> Reserve first\\.  \n>\n> Then charge\\.  "), tooltip);
  });

  it("leaves out a note that is not written", () => {
    const tooltip = codemapTooltip(content({ entry: { ...payment, watch: "Retries." } }));
    assert.ok(tooltip.includes("**Watch:**"));
    for (const missing of ["Why it matters", "Start reading", "In your words"]) {
      assert.ok(!tooltip.includes(missing), missing);
    }
  });

  it("says when the explanation was written", () => {
    const written = new Date(2026, 9, 7, 23, 59);
    assert.ok(codemapTooltip(content({ status: { explanationWritten: written, explanationOlder: false, change: undefined } })).includes("Explanation written 2026-10-07."));
    assert.ok(codemapTooltip(content({ status: { explanationWritten: written, explanationOlder: true, change: undefined } })).includes("Explanation written 2026-10-07, older than the last change."));
    assert.strictEqual(dateOf(new Date(2026, 0, 5)), "2026-01-05");
  });

  it("puts the change marker right below the name", () => {
    const tooltip = codemapTooltip(content({ status: { explanationWritten: undefined, explanationOlder: false, change: { commits: 2 } } }));
    assert.ok(tooltip.startsWith("💰\u2009🧠\u2002**payment\\.py**\n\n$(warning) **Changed since you confirmed it (2 commits)**\n\nReserves"), tooltip);
  });

  it("C13: shows the state with its date and commit, and Own it", () => {
    const check = { verdict: "almost" as const, feedback: "", commit: "e5463289abcdef", mineHash: "h", checkedAt: new Date(2026, 9, 9, 18, 40).toISOString(), durationMilliseconds: 0 };
    const status = { explanationWritten: undefined, explanationOlder: false, change: undefined };
    const actions = [{ title: "Own it", link: "command:reviewGuide.codemap.ownIt?%5B%5D" }, { title: "Explain", link: "command:reviewGuide.codemap.explain?%5B%5D" }];
    const almost = codemapTooltip(content({ status: { ...status, ownership: { kind: "almost", check, commitsSince: 2 } }, actions }));
    assert.ok(almost.includes("\n\n**Do you own it?** almost · checked 2026\\-10\\-09 at e546328\\, 2 commits since\n\n*money · deep module*"), almost);
    assert.ok(almost.endsWith("[Own it](command:reviewGuide.codemap.ownIt?%5B%5D) · [Explain](command:reviewGuide.codemap.explain?%5B%5D)"), almost);
    const owned = codemapTooltip(content({ status: { ...status, ownership: { kind: "owned", check: { ...check, verdict: "understood" }, commitsSince: 0 } } }));
    assert.ok(owned.includes("**Do you own it?** ✅ owned · checked 2026\\-10\\-09 at e546328\n\n"), owned);
    const changed = codemapTooltip(content({ status: { ...status, ownership: { kind: "changed", check: { ...check, verdict: "understood" }, commitsSince: 1 } } }));
    assert.ok(changed.includes("**Do you own it?** changed since your check \\(1 commit\\) · understood 2026\\-10\\-09 at e546328"), changed);
    const noWords = codemapTooltip(content({ status: { ...status, ownership: { kind: "no words" } } }));
    assert.ok(noWords.includes("**Do you own it?** no words yet\\: write mine in the codemap\\, then Check my words"), noWords);
  });

  it("shows the owner's text as written: no Markdown, no links, no icons", () => {
    const sneaky = "*bold* [click](command:workbench.action.terminal.new) $(alert) <b>x</b> `code`";
    const escaped = escapeMarkdown(sneaky);
    assert.ok(!/(^|[^\\])[*[\]()$<>`]/.test(escaped), escaped);
    const tooltip = codemapTooltip(content({ entry: { ...payment, says: sneaky, mine: sneaky } }));
    assert.ok(!tooltip.includes("](command:workbench"), "the owner's text never becomes a command link");
  });
});
