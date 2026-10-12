import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { ReviewGuideApi } from "../../../src/extension";
import { git } from "../../support/gitFixture";
import type { CodemapViewNode } from "../../../src/ui/codemapView";

const root = path.resolve(__dirname, "..", "..", "..", "..");
const fakeClaudeExplainPath = path.join(root, "test", "fixtures", "fake-claude-explain.js");

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
    // The workspace is a git repo, as most are; the codemap stays out of it.
    writeFile(".gitignore", "/.codemap/\n");
    git(workspace, "init", "--quiet", "--initial-branch=main");
    commitAll("Start the shop");
    await vscode.workspace.getConfiguration("reviewGuide").update("claudePath", fakeClaudeExplainPath, vscode.ConfigurationTarget.Global);
    api = await vscode.extensions.getExtension<ReviewGuideApi>("gapsong.review-guide")!.activate();
    writeFile(".codemap/codemap.yaml", codemap);
    await waitFor(() => api.codemapView.getChildren().length > 0, "the view shows the codemap");
  });

  afterEach(async () => {
    await vscode.commands.executeCommand("reviewGuide.codemap.showAll");
  });

  after(() => {
    for (const terminal of vscode.window.terminals) {
      terminal.dispose();
    }
  });

  it("shows the codemap as a tree: plain folders on the way, each entry with its badge, name and sentence", () => {
    assert.strictEqual(api.codemapView.getTreeItem(findNode("💰🧠 payment.py")).label, "💰\u2009🧠\u2002payment.py", "the emoji are set apart");
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
    assert.deepStrictEqual(tooltip.isTrusted, {
      enabledCommands: [
        "reviewGuide.codemap.open", "reviewGuide.codemap.openStart", "reviewGuide.codemap.explain", "reviewGuide.codemap.stillTrue", "reviewGuide.codemap.explainAgain",
        "reviewGuide.codemap.ownIt", "reviewGuide.codemap.checkWords", "reviewGuide.codemap.showChanges",
      ],
    });
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
    assert.deepStrictEqual(await codeLensTitles("shop/checkout/payment.py"), ["💰🧠 Reserves the amount first, then charges it.", "Explain", "🎯 Own it"]);
    assert.deepStrictEqual(await codeLensTitles("shop/app.py"), []);
  });

  it("follows a change of the codemap file, and says so when the codemap is gone", async () => {
    writeFile(".codemap/codemap.yaml", codemap.replace("Amounts in cents.", "Amounts in whole cents."));
    await waitFor(() => outline().includes("    🧰 money.py · Amounts in whole cents."), "the new sentence is shown");
    assert.deepStrictEqual(await codeLensTitles("shop/util/money.py"), ["🧰 Amounts in whole cents.", "Explain", "🎯 Own it"]);

    fs.rmSync(path.join(workspace, ".codemap", "codemap.yaml"));
    await waitFor(() => api.codemapView.getChildren().length === 0, "the view is empty, so it shows its welcome text");
    writeFile(".codemap/codemap.yaml", codemap);
    await waitFor(() => api.codemapView.getChildren().length > 0, "the codemap is back");
  });

  describe("change markers after a commit", () => {
    const paymentFile = () => vscode.Uri.file(path.join(workspace, "shop", "checkout", "payment.py"));

    it("marks nothing at first: the current commit is every entry's starting point", async () => {
      await api.changeMarkers.check();
      assert.ok(!outline().some((line) => line.includes("⚠")), outline().join("\n"));
    });

    it("does not count an edit that is not committed", async () => {
      writeFile("shop/checkout/payment.py", "line 1\nline 2 edited\nline 3\n");
      await api.changeMarkers.check();
      assert.strictEqual(api.changeMarkers.statusOf(paymentFile())!.change, undefined);
    });

    it("marks the entry in the view, the tooltip, the CodeLens and the Explain panel once a commit changes it", async () => {
      commitAll("Charge in cents");
      // No call to check(): the commit alone must bring the marker, through the watch on git's HEAD.
      await waitFor(() => isMarked("💰🧠 payment.py"), "the view shows the marker", 15_000);

      const payment = findNode("💰🧠 payment.py");
      const item = api.codemapView.getTreeItem(payment);
      assert.strictEqual(item.contextValue, "codemapEntryChanged");
      assert.strictEqual(item.iconPath, undefined, "no icon pushes the changed row out of line");
      assert.strictEqual(item.description, "⚠️\u2002changed · Reserves the amount first, then charges it.");
      const tooltip = (api.codemapView.resolveTreeItem(item, payment).tooltip as vscode.MarkdownString).value;
      assert.ok(tooltip.includes("$(warning) **Changed since you confirmed it (1 commit)**"), tooltip);
      assert.match(tooltip, /\[Still true\]\(command:reviewGuide\.codemap\.stillTrue\?.*\[Explain again\]\(command:reviewGuide\.codemap\.explainAgain\?/);
      assert.deepStrictEqual(await codeLensTitles("shop/checkout/payment.py"), [
        "💰🧠 Reserves the amount first, then charges it.",
        "Explain",
        "$(warning) Changed since you confirmed it (1 commit)",
        "Still true",
        "Explain again",
        "🎯 Own it",
      ]);
      assert.ok(!isMarked("🔒 session.py"), "an entry the commit did not touch has no marker");

      await vscode.commands.executeCommand("reviewGuide.codemap.explain", payment);
      await waitFor(() => api.explainPanels.htmlOf(paymentFile())?.includes("Changed since you confirmed it (1 commit).") === true, "the panel shows the marker");
      assert.ok(api.explainPanels.htmlOf(paymentFile())!.includes(">Still true</button>"));
    });

    it("says when an explanation is older than the last commit that changed the path", async () => {
      writeFile(".codemap/explanations/shop/checkout/payment.py/index.html", "<html><body><h1>Payment</h1></body></html>");
      const longAgo = new Date(2020, 0, 1);
      fs.utimesSync(path.join(workspace, ".codemap", "explanations", "shop", "checkout", "payment.py", "index.html"), longAgo, longAgo);
      const payment = findNode("💰🧠 payment.py");
      const tooltip = (api.codemapView.resolveTreeItem(api.codemapView.getTreeItem(payment), payment).tooltip as vscode.MarkdownString).value;
      assert.ok(tooltip.includes("Explanation written 2020-01-01, older than the last change."), tooltip);
    });

    it("Explain again opens the panel and runs Claude Code in a terminal for the path", async () => {
      fs.rmSync(path.join(workspace, ".codemap", "explanations"), { recursive: true, force: true });
      await vscode.commands.executeCommand("reviewGuide.codemap.explainAgain", findNode("💰🧠 payment.py"));
      assert.ok(vscode.window.terminals.some((terminal) => terminal.name === "Explain: shop/checkout/payment.py"), "a terminal named after the path is open");
      await waitFor(() => api.explainPanels.htmlOf(paymentFile())?.includes("<h1>Fake explanation</h1>") === true, "the panel shows the page Claude wrote", 30_000);
    });

    it("Still true clears the marker everywhere, until the next commit that changes the path", async () => {
      await vscode.commands.executeCommand("reviewGuide.codemap.stillTrue", findNode("💰🧠 payment.py"));
      assert.ok(!isMarked("💰🧠 payment.py"));
      assert.deepStrictEqual(await codeLensTitles("shop/checkout/payment.py"), ["💰🧠 Reserves the amount first, then charges it.", "Explain", "🎯 Own it"]);
      assert.ok(!api.explainPanels.htmlOf(paymentFile())!.includes("Changed since you confirmed it"));
      assert.strictEqual(git(workspace, "status", "--porcelain"), "", "the confirmation is not stored in the repo");

      writeFile("shop/checkout/payment.py", "line 1\nline 2 edited again\nline 3\n");
      commitAll("Charge once");
      await waitFor(() => isMarked("💰🧠 payment.py"), "the next commit marks it again", 15_000);
    });
  });

  describe("owning an entry: check my words, the chat, the 3am line (C10-C13)", () => {
    const paymentFile = () => vscode.Uri.file(path.join(workspace, "shop", "checkout", "payment.py"));
    let claudeLog: string;

    before(() => {
      claudeLog = path.join(process.env.REVIEW_GUIDE_TEST_SCRATCH ?? workspace, "fake-claude-codemap-view.log");
      process.env.FAKE_CLAUDE_LOG = claudeLog;
    });

    it("C10-C13 in VS Code: check mine, see ✅ in the view and the CodeLens, a real commit takes it away, a new check brings it back", async () => {
      await api.entryOwnership.refresh();
      assert.strictEqual(api.codemapView.message, "3am 💰🔒: 0 of 2 owned · 2 not checked · next: payment.py");

      await vscode.commands.executeCommand("reviewGuide.codemap.checkWords", findNode("💰🧠 payment.py"));
      await api.entryOwnership.refresh();
      const calls = fs.readFileSync(claudeLog, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { pass: string; cwd: string });
      assert.deepStrictEqual(calls.map((call) => call.pass), ["entry check"], "one read-only call");
      assert.ok(!calls[0].cwd.startsWith(workspace), "Claude ran in the HEAD copy, not in the workspace folder");

      assert.ok(outline().includes("    💰🧠 payment.py · ✅ owned · Reserves the amount first, then charges it."), outline().join("\n"));
      assert.ok(!isMarked("💰🧠 payment.py"), "the understood check confirmed the change marker at its commit");
      assert.strictEqual(api.codemapView.message, "3am 💰🔒: 1 of 2 owned · 1 not checked · next: session.py");
      const lenses = await codeLensTitles("shop/checkout/payment.py");
      assert.match(lenses[lenses.length - 1], /^✅ owned \d{4}-\d{2}-\d{2}$/);
      const payment = findNode("💰🧠 payment.py");
      const tooltip = (api.codemapView.resolveTreeItem(api.codemapView.getTreeItem(payment), payment).tooltip as vscode.MarkdownString).value;
      assert.match(tooltip, /\*\*Do you own it\?\*\* ✅ owned · checked \d{4}\\-\d{2}\\-\d{2} at [0-9a-f]{7}/);
      assert.match(tooltip, /\[Own it\]\(command:reviewGuide\.codemap\.ownIt\?/);
      await waitFor(() => api.explainPanels.htmlOf(paymentFile())?.includes("<span class=\"verdict verdict-understood\">understood</span>") === true, "the Own it view shows the check");

      await vscode.commands.executeCommand("reviewGuide.codemap.showUnowned");
      assert.ok(!outline().some((line) => line.includes("payment.py")), outline().join("\n"));
      assert.ok(outline().some((line) => line.includes("session.py")));
      await vscode.commands.executeCommand("reviewGuide.codemap.showAll");

      writeFile("shop/checkout/payment.py", "line 1\nline 2 charged twice\nline 3\n");
      commitAll("Charge twice");
      await waitFor(() => isMarked("💰🧠 payment.py"), "the commit marks the entry", 15_000);
      await api.entryOwnership.refresh();
      assert.strictEqual(api.codemapView.getTreeItem(findNode("💰🧠 payment.py")).description, "⚠️\u2002changed · Reserves the amount first, then charges it.");
      assert.strictEqual(api.codemapView.message, "3am 💰🔒: 0 of 2 owned · 1 changed · 1 not checked · next: payment.py");
      assert.strictEqual((await codeLensTitles("shop/checkout/payment.py")).pop(), "🎯 Check your words again");

      await vscode.commands.executeCommand("reviewGuide.codemap.stillTrue", findNode("💰🧠 payment.py"));
      await api.entryOwnership.refresh();
      assert.ok(!outline().includes("    💰🧠 payment.py · ✅ owned · Reserves the amount first, then charges it."), "Still true alone does not bring ✅ back");

      await vscode.commands.executeCommand("reviewGuide.codemap.checkWords", findNode("💰🧠 payment.py"));
      await api.entryOwnership.refresh();
      assert.ok(outline().includes("    💰🧠 payment.py · ✅ owned · Reserves the amount first, then charges it."), outline().join("\n"));
      assert.strictEqual(git(workspace, "status", "--porcelain"), "", "nothing was written into the repo");
    });

    it("C12 in VS Code: Show changes opens the diff of the file from the checked commit to HEAD", async () => {
      const checked = git(workspace, "rev-parse", "HEAD");
      writeFile("shop/checkout/payment.py", "line 1\nline 2 charged once\nline 3\n");
      commitAll("Charge once");
      const head = git(workspace, "rev-parse", "HEAD");
      await vscode.commands.executeCommand("reviewGuide.codemap.showChanges", findNode("💰🧠 payment.py"));
      await waitFor(() => vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputTextDiff, "a diff is open");
      const diff = vscode.window.tabGroups.activeTabGroup.activeTab!.input as vscode.TabInputTextDiff;
      assert.ok(diff.original.fsPath.includes(checked) && diff.modified.fsPath.includes(head), `${diff.original.fsPath} -> ${diff.modified.fsPath}`);
      assert.strictEqual(fs.readFileSync(diff.original.fsPath, "utf8"), "line 1\nline 2 charged twice\nline 3\n");
      assert.strictEqual(fs.readFileSync(diff.modified.fsPath, "utf8"), "line 1\nline 2 charged once\nline 3\n");
      assert.ok(!diff.original.fsPath.startsWith(workspace), "the sides live in the extension's storage");
    });

    it("C11 in VS Code: a chat turn shows Claude's reply as a hint and leaves the state alone; Own Next opens the next entry", async () => {
      await api.explainPanels.show(paymentFile(), "ownIt");
      await api.explainPanels.receive(paymentFile(), { type: "chat", text: "Is it reserved before the charge?" });
      await waitFor(() => api.explainPanels.htmlOf(paymentFile())?.includes("<span class=\"muted\">would be</span>") === true, "the reply is shown as a hint");
      assert.ok(api.explainPanels.htmlOf(paymentFile())!.includes("<pre class=\"diagram\">"), "its diagram is preformatted");
      await waitFor(() => isMarked("💰🧠 payment.py"), "the last commit marked the entry", 15_000);
      await api.entryOwnership.refresh();
      assert.strictEqual(api.entryOwnership.stateOf(paymentFile())!.kind, "changed", "the chat's verdict changed nothing");

      await vscode.commands.executeCommand("reviewGuide.codemap.checkWords", findNode("💰🧠 payment.py"));
      await api.entryOwnership.refresh();
      await vscode.commands.executeCommand("reviewGuide.codemap.ownNext");
      const session = vscode.Uri.file(path.join(workspace, "shop", "auth", "session.py"));
      await waitFor(() => api.explainPanels.htmlOf(session)?.includes("No words yet.") === true, "Own Next opens the next entry, which has no words yet");
    });
  });

  // One line per node, indented by depth: the label, then " · " and the description when there is one.
  function outline(nodes: CodemapViewNode[] = api.codemapView.getChildren(), depth = 0): string[] {
    return nodes.flatMap((node) => {
      const item = api.codemapView.getTreeItem(node);
      const description = item.description ? ` · ${String(item.description)}` : "";
      return [`${"  ".repeat(depth)}${plainSpaces(String(item.label))}${description}`, ...outline(api.codemapView.getChildren(node), depth + 1)];
    });
  }

  function findNode(label: string): CodemapViewNode {
    const node = allNodes().find((candidate) => plainSpaces(String(api.codemapView.getTreeItem(candidate).label)) === label);
    if (!node) {
      throw new Error(`No node ${label} in the Codemap view`);
    }
    return node;
  }

  function isMarked(label: string): boolean {
    const item = api.codemapView.getTreeItem(findNode(label));
    return item.contextValue === "codemapEntryChanged" && String(item.description).startsWith("⚠️\u2002changed · ");
  }

  function allNodes(nodes: CodemapViewNode[] = api.codemapView.getChildren()): CodemapViewNode[] {
    return nodes.flatMap((node) => [node, ...allNodes(api.codemapView.getChildren(node))]);
  }

  async function codeLensTitles(repoPath: string): Promise<string[]> {
    const uri = vscode.Uri.file(path.join(workspace, repoPath));
    await vscode.window.showTextDocument(uri);
    const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>("vscode.executeCodeLensProvider", uri);
    return lenses.map((lens) => plainSpaces(lens.command?.title ?? ""));
  }

  function commitAll(message: string): void {
    git(workspace, "add", "--all");
    git(workspace, "commit", "--quiet", "-m", message);
  }

  function writeFile(repoPath: string, text: string): void {
    const file = path.join(workspace, repoPath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
});

// The badge is set apart from the text with a thin space and an en space (see withBadge); the
// tests compare with plain spaces, so they read like the screen.
function plainSpaces(text: string): string {
  return text.replace(/\u2009/g, "").replace(/\u2002/g, " ");
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
