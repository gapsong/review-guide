import * as assert from "assert";
import { CodemapEntry } from "../../src/codemap/codemap";
import { EntryCheck, mineBlockOf } from "../../src/codemap/entryOwnership";
import { ExplainHeader, renderExplainPanel } from "../../src/ui/explainHtml";
import { OwnItModel, renderOwnItPanel } from "../../src/ui/ownItHtml";

const cspSource = "https://csp.example";

const entry: CodemapEntry = {
  path: "shop/payment.py",
  says: "Reserves the amount first, then charges it.",
  label: "money",
  deep: true,
  mine: "First <reserve>, then \"charge\".\nThe receipt is last.",
};

const header: ExplainHeader = {
  path: "shop/payment.py", entry, hasExplanation: true, explanationOlder: false, change: undefined, otherPage: undefined,
  ownership: "almost · checked 2026-10-09 at e546328",
};

const check: EntryCheck = {
  verdict: "almost",
  feedback: "What happens when the <provider> fails before the first token?",
  commit: "e5463289abcdef",
  mineHash: "h",
  checkedAt: new Date(2026, 9, 9, 18, 40).toISOString(),
  durationMilliseconds: 41_000,
};

function model(changes: Partial<OwnItModel> = {}): OwnItModel {
  return {
    mine: entry.mine,
    state: { kind: "almost", check, commitsSince: 0 },
    lastCheck: check,
    conversation: [
      { speaker: "owner", text: "So it stays <open> until a cleanup?" },
      { speaker: "claude", reply: { verdict: "not yet", feedback: "No:\n```\nopen ─► fail <now>\n```", file: "shop/payment.py", line: 12 } },
    ],
    draft: "half typed </textarea><script>alert(1)</script>",
    work: undefined,
    changes: undefined,
    ...changes,
  };
}

describe("C11: the Explain panel's Own it view", () => {
  it("C11: shows mine, the check, the chat and a reply box, all escaped, under a nonce-only policy", () => {
    const html = renderOwnItPanel(header, model(), "n0nce", cspSource);
    assert.ok(html.includes(`content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-n0nce';"`), "only the panel's own script may run");
    assert.strictEqual((html.match(/<script/g) ?? []).length, 1, "one script");
    assert.ok(html.includes("<script nonce=\"n0nce\">"));
    assert.ok(!/javascript:/i.test(html), "no javascript: links");
    assert.ok(!html.includes("<base"), "no base: the explanation page's folder is not this document's");

    assert.ok(html.includes("Your words <span class=\"muted\">(mine, 52 of 1500)</span>"), html);
    assert.ok(html.includes("<blockquote class=\"mine\">First &lt;reserve&gt;, then &quot;charge&quot;.\nThe receipt is last.</blockquote>"));
    assert.ok(html.includes(">Check my words</button>") && html.includes(">Edit in codemap</button>"));
    assert.ok(html.includes("<span class=\"verdict verdict-almost\">almost</span> <span class=\"muted\">2026-10-09 18:40 · HEAD e546328 · 41 s</span>"), html);
    assert.ok(html.includes("What happens when the &lt;provider&gt; fails before the first token?"));
    assert.ok(html.includes("never this chat or the explanation page"));

    assert.ok(html.includes("<strong>You</strong><p>So it stays &lt;open&gt; until a cleanup?</p>"));
    assert.ok(html.includes("<span class=\"muted\">would be</span> <span class=\"verdict verdict-not-yet\">not yet</span>"), "a chat verdict is only a hint");
    assert.ok(html.includes("<pre class=\"diagram\">open ─► fail &lt;now&gt;</pre>"), "ASCII diagrams are preformatted (F16)");
    assert.ok(html.includes("<code>shop/payment.py:12</code>"));
    assert.ok(html.includes(">Use my last message as mine</button>"));
    assert.ok(html.includes("<textarea id=\"chat-text\" rows=\"4\" placeholder=\"Your question, or how you think it works\">half typed &lt;/textarea&gt;&lt;script&gt;alert(1)&lt;/script&gt;</textarea>"), "the draft survives a redraw, escaped");
    assert.ok(!html.includes("<script>alert"));
  });

  it("puts the header on top with the state and both views, Own it pressed", () => {
    const html = renderOwnItPanel(header, model(), "n0nce", cspSource);
    assert.ok(html.includes("<p class=\"ownership\">🎯 almost · checked 2026-10-09 at e546328</p>"));
    assert.match(html, /aria-pressed="false" data-review-guide="\{&quot;type&quot;:&quot;explanation&quot;\}">📖 Explanation<\/button>/);
    assert.match(html, /class="mode pressed" aria-pressed="true" data-review-guide="\{&quot;type&quot;:&quot;ownIt&quot;\}">🎯 Own it<\/button>/);
  });

  it("C10: without mine, says how to add it and offers no check", () => {
    const html = renderOwnItPanel(header, model({ mine: undefined, state: { kind: "no words" }, lastCheck: undefined, conversation: [] }), "n0nce", cspSource);
    assert.ok(html.includes("No words yet. In the codemap, add <code>mine: |</code> to this entry"), html);
    assert.ok(!html.includes(">Check my words</button>"));
    assert.ok(!html.includes("Use my last message as mine"), "nothing to use before a message");
  });

  it("says when the words changed after the check, while a check runs, and while Claude answers", () => {
    assert.ok(renderOwnItPanel(header, model({ state: { kind: "not checked" } }), "n", cspSource).includes("Your words changed after this check; check them again."));
    const checking = renderOwnItPanel(header, model({ work: "checking" }), "n", cspSource);
    assert.ok(checking.includes("Claude is checking your words…") && checking.includes(" disabled data-review-guide=\"{&quot;type&quot;:&quot;checkWords&quot;}\">Checking…</button>"), checking);
    assert.ok(renderOwnItPanel(header, model({ work: "answering" }), "n", cspSource).includes("<button id=\"chat-send\" disabled>Claude is answering…</button>"));
  });

  it("C12: lists the commits since the check with Show changes, or says that the checked commit is gone", () => {
    const changes = { checkedCommit: "e5463289abcdef", commits: ["f3c1a2b Fix the <fallback>"], files: ["shop/payment.py"], commitIsGone: false };
    const html = renderOwnItPanel(header, model({ changes }), "n", cspSource);
    assert.ok(html.includes("Changes since your check <span class=\"muted\">(1 commit)</span>"));
    assert.ok(html.includes("<li><code>f3c1a2b Fix the &lt;fallback&gt;</code></li>"));
    assert.ok(html.includes(">Show changes</button>"));
    const gone = renderOwnItPanel(header, model({ changes: { ...changes, commits: [], files: [], commitIsGone: true } }), "n", cspSource);
    assert.ok(gone.includes("The checked commit e546328 is gone"));
    assert.ok(!renderOwnItPanel(header, model({ changes: { ...changes, commits: [], files: [] } }), "n", cspSource).includes("Changes since your check"));
  });

  it("offers both views in the explanation's header too, Explanation pressed, and none for a path outside the codemap", () => {
    const html = renderExplainPanel({ ...header, hasExplanation: false }, "n0nce", cspSource);
    assert.match(html, /class="mode pressed" aria-pressed="true" data-review-guide="\{&quot;type&quot;:&quot;explanation&quot;\}">📖 Explanation<\/button>/);
    assert.ok(html.includes("<p class=\"ownership\">🎯 almost · checked 2026-10-09 at e546328</p>"));
    assert.ok(!renderExplainPanel({ ...header, entry: undefined, ownership: undefined }, "n0nce", cspSource).includes("Own it"));
  });

  it("makes a mine block of the last message, ready to paste into the entry", () => {
    assert.strictEqual(mineBlockOf("First reserve.\n\nThen charge.  \n"), "  mine: |\n    First reserve.\n\n    Then charge.\n");
  });
});
