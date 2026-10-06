import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { explainPrompt, explainTerminal } from "../../src/claude/explainPrompt";
import { CodemapEntry } from "../../src/codemap/codemap";

const templatePath = path.resolve(__dirname, "..", "..", "..", "media", "explainPrompt.md");
const template = fs.readFileSync(templatePath, "utf8");

const entry: CodemapEntry = {
  path: "apps/api/inference/dispatcher.py",
  says: "Öffnet erst eine Ledger-Zeile, dann ruft er den Adapter.",
  label: "money",
  deep: true,
};

describe("C4: the prompt that generates an explanation", () => {
  it("fills in the path, the codemap entry and the output folder", () => {
    const prompt = explainPrompt(template, { path: entry.path, kind: "file", entry });
    assert.ok(prompt.startsWith("Explain the file `apps/api/inference/dispatcher.py` of this repository"), prompt);
    assert.ok(prompt.includes("path: apps/api/inference/dispatcher.py\nsays: Öffnet erst eine Ledger-Zeile, dann ruft er den Adapter.\nlabel: money\ndeep: true"));
    assert.ok(prompt.includes("Output folder: .codemap/explanations/apps/api/inference/dispatcher.py/"));
    assert.ok(!prompt.includes("{{"), "no placeholder is left");
  });

  it("says \"none\" for a path that is not in the codemap", () => {
    const prompt = explainPrompt(template, { path: "apps/web", kind: "folder", entry: undefined });
    assert.ok(prompt.startsWith("Explain the folder `apps/web`"));
    assert.ok(prompt.includes("```\nnone\n```"));
  });

  it("asks for what the reviewer needs: a self-contained page, German, file:line, the label's shape, no em dash", () => {
    for (const asked of [
      "self-contained page, `index.html`",
      "without network access",
      "German",
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
    const prompt = explainPrompt("{{path}} -> {{outputFolder}}", { path: "docs/{{entry}}.md", kind: "file", entry: undefined });
    assert.strictEqual(prompt, "docs/{{entry}}.md -> .codemap/explanations/docs/{{entry}}.md/");
  });

  it("refuses a template with an unknown placeholder", () => {
    assert.throws(() => explainPrompt("{{constructor}}", { path: "a", kind: "file", entry: undefined }), /unknown placeholder \{\{constructor\}\}/);
  });

  it("starts Claude Code itself with the prompt as one argument, so no file name can become a shell command", () => {
    const nasty = "src/it's \"odd\" $(touch pwned) `id`; rm -rf ~.py";
    const terminal = explainTerminal("/home/reviewer/.local/bin/claude", template, { path: nasty, kind: "file", entry: undefined });
    assert.strictEqual(terminal.name, `Explain: ${nasty}`);
    assert.strictEqual(terminal.executable, "/home/reviewer/.local/bin/claude");
    assert.deepStrictEqual(terminal.args, [explainPrompt(template, { path: nasty, kind: "file", entry: undefined })]);
    assert.ok(terminal.args[0].includes(`Output folder: .codemap/explanations/${nasty}/`), "the path arrives byte for byte");
  });
});
