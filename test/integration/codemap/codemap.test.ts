import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { explainPrompt } from "../../../src/claude/explainPrompt";
import type { ReviewGuideApi } from "../../../src/extension";

const root = path.resolve(__dirname, "..", "..", "..", "..");
const fakeClaudeExplainPath = path.join(root, "test", "fixtures", "fake-claude-explain.js");
const template = fs.readFileSync(path.join(root, "media", "explainPrompt.md"), "utf8");

// A file name that would run a command if it ever reached a shell unquoted.
const oddFile = "src/it's \"odd\" $(touch pwned).py";

const codemap = `# the reviewer's notes
- path: src/dispatcher.py
  says: Opens a ledger row first & then calls the adapter.
  label: money
  deep: true

- path: src/auth.py
  says: Bearer token in, workspace out.
  label: core

- path: src/billing
  says: Plans and invoices.
  label: util

- path: src/gone.py
  says: Was moved away.
  label: util

- path: src/broken.py
  says: Has a label that does not exist.
  label: important
`;

describe("the codemap in a real VS Code", () => {
  let api: ReviewGuideApi;
  let workspace: string;

  before(async () => {
    workspace = vscode.workspace.workspaceFolders![0].uri.fsPath;
    for (const file of ["src/dispatcher.py", "src/auth.py", "src/billing/plans.py", oddFile]) {
      writeFile(file, "pass\n");
    }
    await vscode.workspace.getConfiguration("reviewGuide").update("claudePath", fakeClaudeExplainPath, vscode.ConfigurationTarget.Global);
    api = await vscode.extensions.getExtension<ReviewGuideApi>("gapsong.review-guide")!.activate();
    // Written after activation, so the badges can only appear through the file watcher.
    writeFile(".codemap/codemap.yaml", codemap);
  });

  after(() => {
    for (const terminal of vscode.window.terminals) {
      terminal.dispose();
    }
  });

  it("C1: gives every codemap path its badge and its sentence on hover, without a reload", async () => {
    const dispatcher = uriOf("src/dispatcher.py");
    await waitFor(() => api.codemapDecorations.provideFileDecoration(dispatcher) !== undefined, "the codemap is read");
    const decoration = api.codemapDecorations.provideFileDecoration(dispatcher)!;
    assert.strictEqual(decoration.badge, "💰🧠");
    assert.strictEqual(decoration.tooltip, "Opens a ledger row first & then calls the adapter. · money · deep module");
    assert.strictEqual(decoration.propagate, false);
    assert.strictEqual(decoration.color, undefined);
    assert.strictEqual(api.codemapDecorations.provideFileDecoration(uriOf("src/billing"))!.badge, "🧰");
    assert.strictEqual(api.codemapDecorations.provideFileDecoration(uriOf("src/billing/plans.py")), undefined, "a folder's badge is not passed on to its files");
    assert.strictEqual(api.codemapDecorations.provideFileDecoration(uriOf("src/broken.py")), undefined, "an entry with a problem gets no badge");
  });

  it("C2: shows each problem of the codemap on its line in the Problems view", async () => {
    const codemapUri = uriOf(".codemap/codemap.yaml");
    await waitFor(() => vscode.languages.getDiagnostics(codemapUri).length === 2, "two problems are shown");
    const problems = vscode.languages.getDiagnostics(codemapUri).map((problem) => [problem.range.start.line + 1, problem.message]);
    assert.deepStrictEqual(problems, [
      [15, "path does not exist (moved or deleted?)"],
      [21, "label \"important\" is not one of money, security, core, feature, util"],
    ]);
  });

  it("C1, C2: follows a change of the codemap file", async () => {
    writeFile(".codemap/codemap.yaml", codemap.replace("label: core", "label: security").replace(/- path: src\/gone\.py[\s\S]*?label: util\n\n/, ""));
    await waitFor(() => api.codemapDecorations.provideFileDecoration(uriOf("src/auth.py"))?.badge === "🔒", "the new label is shown");
    await waitFor(() => vscode.languages.getDiagnostics(uriOf(".codemap/codemap.yaml")).length === 1, "the fixed problem is gone");
  });

  it("C3: Explain opens a panel with the entry, and shows the explanation as soon as it is written", async () => {
    const dispatcher = uriOf("src/dispatcher.py");
    await vscode.commands.executeCommand("reviewGuide.explainPath", dispatcher);
    await waitFor(() => activeTabLabel() === "Explain: dispatcher.py", "the panel is the active tab");
    const before = api.explainPanels.htmlOf(dispatcher)!;
    for (const shown of ["💰🧠", "src/dispatcher.py", "Opens a ledger row first &amp; then calls the adapter.", "money · deep module", ">Generate explanation</button>"]) {
      assert.ok(before.includes(shown), `the panel shows "${shown}"`);
    }

    fs.mkdirSync(path.join(workspace, ".codemap", "explanations", "src", "dispatcher.py"), { recursive: true });
    fs.copyFileSync(path.join(root, "test", "fixtures", "pixel.gif"), path.join(workspace, ".codemap", "explanations", "src", "dispatcher.py", "flow.gif"));
    writeFile(".codemap/explanations/src/dispatcher.py/index.html", "<html><head></head><body><h1>Der Dispatcher</h1><img src=\"flow.gif\"></body></html>");
    await waitFor(() => api.explainPanels.htmlOf(dispatcher)!.includes("<h1>Der Dispatcher</h1>"), "the panel shows the written page");
    const after = api.explainPanels.htmlOf(dispatcher)!;
    assert.ok(after.includes(">Regenerate</button>"));
    assert.match(after, /<base href="https:\/\/[^"]*vscode-resource[^"]*\/\.codemap\/explanations\/src\/dispatcher\.py\/">/);
  });

  it("C3: explains a path that is not in the codemap yet", async () => {
    const plans = uriOf("src/billing/plans.py");
    await vscode.commands.executeCommand("reviewGuide.explainPath", plans);
    await waitFor(() => activeTabLabel() === "Explain: plans.py", "the panel is the active tab");
    assert.ok(api.explainPanels.htmlOf(plans)!.includes("Not in the codemap yet."));
  });

  it("C4: the button runs Claude Code in a terminal with the prompt as one argument; the panel shows the page it writes", async () => {
    const odd = uriOf(oddFile);
    await vscode.commands.executeCommand("reviewGuide.explainPath", odd);
    await api.explainPanels.receive(odd, { type: "generate" });

    assert.ok(vscode.window.terminals.some((terminal) => terminal.name === `Explain: ${oddFile}`), "a terminal named after the path is open");
    await waitFor(() => api.explainPanels.htmlOf(odd)!.includes("<h1>Fake explanation</h1>"), "the panel shows the page Claude wrote", 30_000);
    assert.ok(api.explainPanels.htmlOf(odd)!.includes("<p>1 argument(s)</p>"));
    const prompt = fs.readFileSync(path.join(workspace, ".codemap", "explanations", oddFile, "prompt.txt"), "utf8");
    assert.strictEqual(prompt, explainPrompt(template, { path: oddFile, kind: "file", entry: undefined }));
    assert.ok(!fs.existsSync(path.join(workspace, "pwned")), "no part of the file name ran as a command");
  });

  function uriOf(repoPath: string): vscode.Uri {
    return vscode.Uri.file(path.join(workspace, repoPath));
  }

  function writeFile(repoPath: string, text: string): void {
    const file = path.join(workspace, repoPath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
});

function activeTabLabel(): string | undefined {
  return vscode.window.tabGroups.activeTabGroup.activeTab?.label;
}

async function waitFor(condition: () => boolean, what: string, timeoutMilliseconds = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting until ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
