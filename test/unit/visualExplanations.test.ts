import * as assert from "assert";
import { deepCheckPrompt } from "../../src/claude/deepCheckPrompt";
import { entryChatPrompt } from "../../src/claude/entryCheckPrompt";
import { ownershipPrompt } from "../../src/claude/ownershipPrompt";
import { ReviewUnit } from "../../src/review/reviewUnit";
import { GuideModel, renderGuide } from "../../src/ui/guideHtml";

const unit: ReviewUnit = {
  id: "qpeft/quant_schemes/base.py#function:_ste",
  file: "qpeft/quant_schemes/base.py",
  kind: "function",
  symbolPath: "_ste",
  newRange: { start: 27, end: 30 },
  lines: [{ kind: "added", text: "    return value.detach() + (x - x.detach())", newLine: 30 }],
  hash: "h",
  isTestFile: false,
  existedBefore: true,
};

const pullRequest = {
  repo: { owner: "example", name: "qpeft" }, number: 8, title: "STE fix", body: "", author: "tester", url: "",
  cloneUrl: "", baseRef: "main", baseSha: "a", headRef: "develop", headSha: "b",
};

describe("F16: explanations are visual and use analogies", () => {
  const prompts = {
    "pass 2": deepCheckPrompt({ pullRequest, profile: undefined, units: [{ shortId: "U1", unit, reason: "STE" }], contextFolder: "/context" }),
    "ownership chat": ownershipPrompt(unit, [], "It rounds."),
    "entry chat": entryChatPrompt({ path: "qpeft/quant_schemes/base.py", says: "Rounds with an STE.", label: "core", deep: false }, [], "It rounds.", { commit: "b", contextFolder: "/context", language: "English" }),
  };

  for (const [name, prompt] of Object.entries(prompts)) {
    it(`the ${name} prompt asks for an ASCII diagram and an everyday analogy mapped back to the code`, () => {
      assert.match(prompt, /ASCII diagram inside a fenced code block/);
      assert.match(prompt, /data flow, tensor shapes, a bit layout, or before\/after/);
      assert.match(prompt, /Explain WHY with an everyday analogy, then map the analogy back to the code/);
    });
  }

  it("the guide panel renders fenced blocks as preformatted text, escaped, in plain words, questions and the chat", () => {
    const diagram = "```\nforward  uses value:   __|--|__\nbackward uses x:          /   <slope 1>\n```";
    const model: GuideModel = {
      pullRequestNumber: 8,
      file: unit.file,
      title: "_ste()",
      lines: "lines 27-30",
      tier: "critical",
      reason: "STE",
      worthHaving: undefined,
      readState: "read",
      changedSinceReview: false,
      deepCheck: {
        plainWords: `Rounding is a staircase.\n${diagram}\nLike a thermostat display.`,
        blockingProblems: [],
        questions: [{ text: `Check: the zero that carries x's slope:\n${diagram}`, file: unit.file, lines: { start: 30, end: 30 }, isDefault: false }],
        checked: [],
        onlyYouCanCheck: [],
        unconfirmed: [],
        anchorLine: 27,
      },
      explanation: "It rounds.",
      draft: undefined,
      conversation: [
        { speaker: "reviewer", text: "Why detach?" },
        { speaker: "claude", result: { verdict: "almost", feedback: `See:\n${diagram}` } },
      ],
      checkingExplanation: false,
    };
    const html = renderGuide(model, "nonce", "csp");
    const block = `<pre class="diagram">forward  uses value:   __|--|__\nbackward uses x:          /   &lt;slope 1&gt;</pre>`;
    assert.strictEqual(html.split(block).length - 1, 3, "plain words, the question and the chat reply each show the diagram");
    assert.ok(html.includes("<p>Like a thermostat display.</p>"));
  });
});
