import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { ReviewGuideApi } from "../../../src/extension";
import type { GodFilesViewNode } from "../../../src/ui/godFilesView";
import { fingerprint, git } from "../../support/gitFixture";

const root = path.resolve(__dirname, "..", "..", "..", "..");
const fakeClaudePath = path.join(root, "test", "fixtures", "fake-claude.js");

type FileNode = Extract<GodFilesViewNode, { kind: "file" }>;

// A broad file that 12 names of which 3 areas use, and a long, narrow module.
function broadFile(): string {
  const functions = Array.from({ length: 12 }, (_, index) => `export function broad${index + 1}(): void {\n${body(index === 6 ? 40 : 12)}\n}\n`);
  return functions.join("\n");
}

function body(lines: number): string {
  return Array.from({ length: lines }, (_, index) => `  step${index}();`).join("\n");
}

describe("God Files in a real VS Code", () => {
  let api: ReviewGuideApi;
  let workspace: string;
  let folderUri: string;

  before(async () => {
    workspace = vscode.workspace.workspaceFolders![0].uri.fsPath;
    folderUri = vscode.workspace.workspaceFolders![0].uri.toString();
    writeFile("src/shop/broad.ts", broadFile());
    writeFile("apps/web/page.ts", "import { broad1, broad2, broad3, broad4 } from '../../src/shop/broad';\nimport { post } from '../../src/ledger/ledger';\n");
    writeFile("packages/billing/charge.ts", "import { broad5, broad6, broad7, broad8 } from '../../src/shop/broad';\nimport { balance } from '../../src/ledger/ledger';\n");
    writeFile("src/admin/panel.ts", "import * as shop from '../shop/broad';\nshop.broad9(); shop.broad10(); shop.broad11(); shop.broad12();\n");
    writeFile(".gitignore", "/.codemap/\n");
    git(workspace, "init", "--quiet", "--initial-branch=main");
    commitAll("Start the shop");
    // The ledger comes in its own commit: a deep module changes for one reason, so it must not
    // share a commit with files of other areas.
    writeFile("src/ledger/ledger.ts", `export function post(): void {\n${body(300)}\n}\nexport function balance(): number {\n${body(300)}\n  return 0;\n}\n`);
    commitAll("Add the ledger");
    for (const partner of ["apps/web/page.ts", "packages/billing/charge.ts", "src/admin/panel.ts"]) {
      appendLine("src/shop/broad.ts");
      appendLine(partner);
      commitAll(`Change broad with ${partner}`);
    }
    const codemap = "- path: src/shop/broad.ts\n  says: Prices and shipping.\n  label: money\n  deep: true\n";
    writeFile(".codemap/codemap.yaml", codemap);
    await vscode.workspace.getConfiguration("reviewGuide").update("claudePath", fakeClaudePath, vscode.ConfigurationTarget.Global);
    api = await vscode.extensions.getExtension<ReviewGuideApi>("gapsong.review-guide")!.activate();
    // The extension may have started before the codemap was written, and on Linux VS Code's watcher
    // misses a file created together with its folder (TASKS.md): writing it once more is seen.
    const broadUri = vscode.Uri.file(path.join(workspace, "src/shop/broad.ts"));
    for (let attempt = 0; attempt < 20 && !api.codemaps.entryOf(broadUri); attempt++) {
      writeFile(".codemap/codemap.yaml", `${codemap}\n`.repeat(1 + (attempt % 2)));
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(api.codemaps.entryOf(broadUri), "the codemap is read");
    await vscode.commands.executeCommand("workbench.view.extension.reviewGuide");
    await vscode.commands.executeCommand("reviewGuide.godFiles.focus");
    await waitFor(() => fileNodes().length > 0, "the view shows the measured files", 30_000);
  });

  after(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  it("G5: shows the files ranked by breadth and history, with the numbers line, and writes nothing into the repo", async () => {
    const before = fingerprint(workspace);
    await vscode.commands.executeCommand("reviewGuide.godFiles.refresh");
    const nodes = fileNodes();
    assert.deepStrictEqual(nodes.map((node) => node.path), ["src/shop/broad.ts", "src/ledger/ledger.ts"]);
    const broad = api.godFilesView.getTreeItem(nodes[0]);
    assert.strictEqual(plain(String(broad.label)), "⚠ 💰🧠 src/shop/broad.ts", "the mark, the codemap badge and the path");
    assert.strictEqual(broad.description, "⚠️ codemap says deep · god file? · 12 names used by 3 files · 4 commits/90 d · changes with 3 areas · 196 lines");
    const ledger = api.godFilesView.getTreeItem(nodes[1]);
    assert.strictEqual(ledger.label, "✓ src/ledger/ledger.ts");
    assert.strictEqual(ledger.description, "deep · 2 names used by 2 files · 1 commit/90 d · changes with 0 areas · 605 lines");
    assert.ok(api.godFilesView.message?.includes("ranked by breadth and history, never by length"));
    assert.strictEqual(fingerprint(workspace), before, "no byte in the repo (its .git and .codemap included) changed");
    assert.strictEqual(git(workspace, "status", "--porcelain"), "", "no new file in the repo");
  });

  it("G5, G6: the tooltip explains each number and the owner's rule, and warns that the codemap calls a broad file deep", () => {
    const node = fileNodes()[0];
    const item = api.godFilesView.resolveTreeItem(api.godFilesView.getTreeItem(node), node);
    const tooltip = (item.tooltip as vscode.MarkdownString).value.replace(/\\(.)/g, "$1");
    for (const part of ["Your codemap calls this file a deep module, but 12 of its names are used by other files", "Codemap: 💰", "12 names used by 3 files:", "4 commits in 90 days", "A big file is fine only as a well-designed deep module", "command:reviewGuide.godFiles.judge"]) {
      assert.ok(tooltip.includes(part), `${part}\n---\n${tooltip}`);
    }
  });

  it("G5: a click opens the file at its longest function", async () => {
    const node = fileNodes()[0];
    const command = api.godFilesView.getTreeItem(node).command!;
    await vscode.commands.executeCommand(command.command, ...(command.arguments ?? []));
    const editor = vscode.window.activeTextEditor!;
    assert.strictEqual(editor.document.uri.fsPath, path.join(workspace, "src/shop/broad.ts"));
    const longestStart = broadFile().split("\n").findIndex((line) => line.startsWith("export function broad7("));
    await waitFor(() => vscode.window.activeTextEditor?.selection.active.line === longestStart, `the cursor is on line ${longestStart + 1}, broad7`, 30_000);
  });

  it("G5: measures again by itself when HEAD moves", async () => {
    const oldCommit = reportCommit();
    appendLine("src/ledger/ledger.ts");
    commitAll("Change the ledger");
    const newCommit = git(workspace, "rev-parse", "HEAD");
    assert.notStrictEqual(newCommit, oldCommit);
    await waitFor(() => reportCommit() === newCommit, "the report is for the new HEAD", 20_000);
    const ledger = fileNodes().find((node) => node.path === "src/ledger/ledger.ts")!;
    assert.strictEqual(ledger.item.commits, 2);
  });

  it("G7: Judge with Claude runs on the command in the Explain panel, shows the judgment escaped, and its code links open checked lines", async () => {
    const node = fileNodes()[0];
    const uri = vscode.Uri.file(path.join(workspace, node.path));
    await vscode.commands.executeCommand("reviewGuide.codemap.explain", { folderUri, path: node.path });
    assert.ok(api.explainPanels.htmlOf(uri)?.includes("⚖️ Judge"), "the Explain panel offers Judge for a measured file");
    await api.explainPanels.receive(uri, { type: "judge" });
    assert.ok(api.explainPanels.htmlOf(uri)?.includes(">Judge with Claude</button>"), "showing the view does not judge");
    await vscode.commands.executeCommand("reviewGuide.godFiles.judge", node);
    const html = api.explainPanels.htmlOf(uri)!;
    assert.ok(html.includes("God file</span>"), html);
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
    assert.ok(html.includes("Judge again"));
    await api.explainPanels.receive(uri, { type: "openLine", line: 3 });
    await waitFor(() => vscode.window.activeTextEditor?.document.uri.fsPath === uri.fsPath && vscode.window.activeTextEditor.selection.active.line === 2, "the reading path's third step opens line 3");
  });

  function fileNodes(): FileNode[] {
    return api.godFilesView.getChildren().filter((node): node is FileNode => node.kind === "file");
  }

  function reportCommit(): string | undefined {
    const state = api.godFilesView.stateOf(folderUri);
    return state?.state === "ready" ? state.report.commit : undefined;
  }

  function writeFile(relativePath: string, content: string): void {
    fs.mkdirSync(path.dirname(path.join(workspace, relativePath)), { recursive: true });
    fs.writeFileSync(path.join(workspace, relativePath), content);
  }

  function appendLine(relativePath: string): void {
    fs.appendFileSync(path.join(workspace, relativePath), "// changed\n");
  }

  function commitAll(message: string): void {
    git(workspace, "add", "--all");
    git(workspace, "commit", "--quiet", "-m", message);
  }
});

function plain(text: string): string {
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
