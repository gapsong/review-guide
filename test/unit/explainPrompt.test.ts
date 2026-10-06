import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { explainPrompt, explainTerminal } from "../../src/claude/explainPrompt";
import { CodemapEntry } from "../../src/codemap/codemap";

const templatePath = path.resolve(__dirname, "..", "..", "..", "media", "explainPrompt.md");
const template = fs.readFileSync(templatePath, "utf8");

const entry: CodemapEntry = {
  path: "shop/checkout/payment.py",
  says: "Reserves the amount first (in €), then charges it.",
  label: "money",
  deep: true,
};

describe("C4: the prompt that generates an explanation", () => {
  it("fills in the path, the codemap entry and the output folder", () => {
    const prompt = explainPrompt(template, { path: entry.path, kind: "file", entry }, "English");
    assert.ok(prompt.startsWith("Explain the file `shop/checkout/payment.py` of this repository"), prompt);
    assert.ok(prompt.includes("path: shop/checkout/payment.py\nsays: Reserves the amount first (in €), then charges it.\nlabel: money\ndeep: true"));
    assert.ok(prompt.includes("Output folder: .codemap/explanations/shop/checkout/payment.py/"));
    assert.ok(!prompt.includes("{{"), "no placeholder is left");
  });

  it("says \"none\" for a path that is not in the codemap", () => {
    const prompt = explainPrompt(template, { path: "shop/cart", kind: "folder", entry: undefined }, "English");
    assert.ok(prompt.startsWith("Explain the folder `shop/cart`"));
    assert.ok(prompt.includes("```\nnone\n```"));
  });

  it("writes the page in the language of the setting, English when it is empty", () => {
    const request = { path: "shop/cart", kind: "folder" as const, entry: undefined };
    assert.ok(explainPrompt(template, request, "German").includes("- Write the page in German."));
    assert.ok(explainPrompt(template, request, "  ").includes("- Write the page in English."));
  });

  it("asks for what the owner needs: a self-contained page, file:line, the label's shape, no em dash", () => {
    assert.ok(!template.includes("German"), "the language comes from the setting, not the template");
    for (const asked of [
      "self-contained page, `index.html`",
      "without network access",
      "`file:line`",
      "money: show where the cost is decided and where it is recorded, and who loses money if this code breaks.",
      "security: show where the secret or identity is born, where it lives and where it dies, and which attack this code stops.",
      "core: show its place in the main request path",
      "feature: show a real screenshot of where users see this feature, plus 3 sentences.",
      "util: only 3 sentences, no images.",
      "deep (when the entry says `deep: true`): put the small interface first, then what it hides",
      "`explain-visually` skill",
      "Never use the em dash character",
    ]) {
      assert.ok(template.includes(asked), `the prompt asks for: ${asked}`);
    }
    assert.ok(!template.includes("\u2014"), "the prompt itself has no em dash");
  });

  it("fills each placeholder once, so a file name with {{...}} stays as it is", () => {
    const prompt = explainPrompt("{{path}} -> {{outputFolder}}", { path: "docs/{{entry}}.md", kind: "file", entry: undefined }, "English");
    assert.strictEqual(prompt, "docs/{{entry}}.md -> .codemap/explanations/docs/{{entry}}.md/");
  });

  it("refuses a template with an unknown placeholder", () => {
    assert.throws(() => explainPrompt("{{constructor}}", { path: "a", kind: "file", entry: undefined }, "English"), /unknown placeholder \{\{constructor\}\}/);
  });

  it("starts Claude Code itself with the prompt as one argument, so no file name can become a shell command", () => {
    const nasty = "src/it's \"odd\" $(touch pwned) `id`; rm -rf ~.py";
    const terminal = explainTerminal({ claudePath: "/home/someone/.local/bin/claude", language: "English" }, template, { path: nasty, kind: "file", entry: undefined });
    assert.strictEqual(terminal.name, `Explain: ${nasty}`);
    assert.strictEqual(terminal.executable, "/home/someone/.local/bin/claude");
    assert.deepStrictEqual(terminal.args, [explainPrompt(template, { path: nasty, kind: "file", entry: undefined }, "English")]);
    assert.ok(terminal.args[0].includes(`Output folder: .codemap/explanations/${nasty}/`), "the path arrives byte for byte");
  });
});
