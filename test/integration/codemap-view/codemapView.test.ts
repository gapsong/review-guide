import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { ReviewGuideApi } from "../../../src/extension";
import type { CodemapViewNode } from "../../../src/ui/codemapView";

const codemap = `- path: shop
  says: The shop's HTTP API.
  label: core

- path: shop/checkout/payment.py
  says: Reserves the amount first, then charges it.
  label: money
  deep: true
  why: A wrong amount is charged to a real card.
  watch: The provider retries on timeout.
  start: shop/checkout/payment.py:3
  mine: |
    Reserve first.
    Then charge.

- path: shop/auth/session.py
  says: Checks the session cookie.
  label: security

- path: shop/util/money.py
  says: Amounts in cents.
  label: util
`;

describe("the Codemap view and CodeLens in a real VS Code", () => {
  let api: ReviewGuideApi;
  let workspace: string;

  before(async () => {
    workspace = vscode.workspace.workspaceFolders![0].uri.fsPath;
    for (const file of ["shop/checkout/payment.py", "shop/auth/session.py", "shop/util/money.py", "shop/app.py"]) {
      writeFile(file, "line 1\nline 2\nline 3\n");
    }
    api = await vscode.extensions.getExtension<ReviewGuideApi>("gapsong.review-guide")!.activate();
    writeFile(".codemap/codemap.yaml", codemap);
    await waitFor(() => api.codemapView.getChildren().length > 0, "the view shows the codemap");
  });

  afterEach(async () => {
    await vscode.commands.executeCommand("reviewGuide.codemap.showAll");
  });

  it("shows the codemap as a tree: plain folders on the way, each entry with its badge, name and sentence", () => {
    assert.deepStrictEqual(outline(), [
      "⚙️ shop · The shop's HTTP API.",
      "  auth",
      "    🔒 session.py · Checks the session cookie.",
      "  checkout",
      "    💰🧠 payment.py · Reserves the amount first, then charges it.",
      "  util",
      "    🧰 money.py · Amounts in cents.",
    ]);
  });

  it("shows the sentence, the notes, the label, the explanation status and an Explain link in the tooltip", () => {
    const payment = findNode("💰🧠 payment.py");
    const item = api.codemapView.resolveTreeItem(api.codemapView.getTreeItem(payment), payment);
    const tooltip = item.tooltip as vscode.MarkdownString;
    for (const shown of ["Reserves the amount first\\, then charges it\\.", "**Why it matters:** A wrong amount", "**Watch:** The provider", "**Start reading:** [shop", "> Reserve first\\.", "*money · deep module*", "No explanation yet."]) {
      assert.ok(tooltip.value.includes(shown), `the tooltip shows ${shown}:\n${tooltip.value}`);
    }
    assert.match(tooltip.value, /\[Explain\]\(command:reviewGuide\.codemap\.explain\?/);
    assert.deepStrictEqual(tooltip.isTrusted, { enabledCommands: ["reviewGuide.codemap.open", "reviewGuide.codemap.openStart", "reviewGuide.codemap.explain"] });
  });

  it("filters to money, security or deep modules, and back to all", async () => {
    await vscode.commands.executeCommand("reviewGuide.codemap.showMoney");
    assert.deepStrictEqual(outline(), ["shop/checkout", "  💰🧠 payment.py · Reserves the amount first, then charges it."]);
    await vscode.commands.executeCommand("reviewGuide.codemap.showSecurity");
    assert.deepStrictEqual(outline(), ["shop/auth", "  🔒 session.py · Checks the session cookie."]);
    await vscode.commands.executeCommand("reviewGuide.codemap.showDeep");
    assert.deepStrictEqual(outline(), ["shop/checkout", "  💰🧠 payment.py · Reserves the amount first, then charges it."]);
    await vscode.commands.executeCommand("reviewGuide.codemap.showAll");
    assert.strictEqual(outline().length, 7);
  });

  it("opens a file entry on click, and the file that start points to at its line", async () => {
    const session = findNode("🔒 session.py");
    const click = api.codemapView.getTreeItem(session).command!;
    await vscode.commands.executeCommand(click.command, ...click.arguments!);
    await waitFor(() => vscode.window.activeTextEditor?.document.uri.fsPath === path.join(workspace, "shop", "auth", "session.py"), "session.py is open");

    await vscode.commands.executeCommand("reviewGuide.codemap.openStart", findNode("💰🧠 payment.py"));
    await waitFor(() => vscode.window.activeTextEditor?.document.uri.fsPath === path.join(workspace, "shop", "checkout", "payment.py"), "payment.py is open");
    assert.strictEqual(vscode.window.activeTextEditor!.selection.active.line, 2, "at line 3");
  });

  it("opens the Explain panel from the view's inline action, with the notes in its header", async () => {
    await vscode.commands.executeCommand("reviewGuide.codemap.explain", findNode("💰🧠 payment.py"));
    await waitFor(() => vscode.window.tabGroups.activeTabGroup.activeTab?.label === "Explain: payment.py", "the panel is the active tab");
    const html = api.explainPanels.htmlOf(vscode.Uri.file(path.join(workspace, "shop", "checkout", "payment.py")))!;
    for (const shown of ["<dt>Why it matters</dt>", "<dt>Watch</dt>", ">shop/checkout/payment.py:3</button>", "<blockquote>Reserve first.\nThen charge.</blockquote>"]) {
      assert.ok(html.includes(shown), `the panel shows ${shown}`);
    }
  });

  it("puts the badge, the sentence and Explain above the first line of a file in the codemap, and nothing on other files", async () => {
    assert.deepStrictEqual(await codeLensTitles("shop/checkout/payment.py"), ["💰🧠 Reserves the amount first, then charges it.", "Explain"]);
    assert.deepStrictEqual(await codeLensTitles("shop/app.py"), []);
  });

  it("follows a change of the codemap file, and says so when the codemap is gone", async () => {
    writeFile(".codemap/codemap.yaml", codemap.replace("Amounts in cents.", "Amounts in whole cents."));
    await waitFor(() => outline().includes("    🧰 money.py · Amounts in whole cents."), "the new sentence is shown");
    assert.deepStrictEqual(await codeLensTitles("shop/util/money.py"), ["🧰 Amounts in whole cents.", "Explain"]);

    fs.rmSync(path.join(workspace, ".codemap", "codemap.yaml"));
    await waitFor(() => api.codemapView.getChildren().length === 0, "the view is empty, so it shows its welcome text");
    writeFile(".codemap/codemap.yaml", codemap);
    await waitFor(() => api.codemapView.getChildren().length > 0, "the codemap is back");
  });

  // One line per node, indented by depth: the label, then " · " and the description when there is one.
  function outline(nodes: CodemapViewNode[] = api.codemapView.getChildren(), depth = 0): string[] {
    return nodes.flatMap((node) => {
      const item = api.codemapView.getTreeItem(node);
      const description = item.description ? ` · ${String(item.description)}` : "";
      return [`${"  ".repeat(depth)}${String(item.label)}${description}`, ...outline(api.codemapView.getChildren(node), depth + 1)];
    });
  }

  function findNode(label: string): CodemapViewNode {
    const node = allNodes().find((candidate) => api.codemapView.getTreeItem(candidate).label === label);
    if (!node) {
      throw new Error(`No node ${label} in the Codemap view`);
    }
    return node;
  }

  function allNodes(nodes: CodemapViewNode[] = api.codemapView.getChildren()): CodemapViewNode[] {
    return nodes.flatMap((node) => [node, ...allNodes(api.codemapView.getChildren(node))]);
  }

  async function codeLensTitles(repoPath: string): Promise<string[]> {
    const uri = vscode.Uri.file(path.join(workspace, repoPath));
    await vscode.window.showTextDocument(uri);
    const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>("vscode.executeCodeLensProvider", uri);
    return lenses.map((lens) => lens.command?.title ?? "");
  }

  function writeFile(repoPath: string, text: string): void {
    const file = path.join(workspace, repoPath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
});

async function waitFor(condition: () => boolean, what: string, timeoutMilliseconds = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting until ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
