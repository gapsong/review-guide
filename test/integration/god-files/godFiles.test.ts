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

// A class with 12 public methods that three areas call (through a barrel, a namespace import and
// an aliased import), a private one nobody may call, and one function that is hard to read.
const methods = Array.from({ length: 12 }, (_, index) => `method${index + 1}`);

function broadFile(): string {
  const members = methods.map((name) => `  ${name}(): number {\n${body(12)}\n    return 1;\n  }\n`).join("");
  return `export class Shop {\n  private secret(): number { return 0; }\n${members}}\n\nexport function hardest(x: number): number {\n  if (x > 1) {\n    for (let i = 0; i < x; i++) {\n      if (i % 2 === 0 && x > 3) {\n        x--;\n      }\n    }\n  }\n  return x;\n}\n`;
}

function body(lines: number): string {
  return Array.from({ length: lines }, (_, index) => `    step${index}();`).join("\n");
}

function calls(variable: string, names: string[]): string {
  return names.map((name) => `${variable}.${name}();`).join("\n");
}

describe("God Files in a real VS Code", () => {
  let api: ReviewGuideApi;
  let workspace: string;
  let folderUri: string;

  before(async () => {
    workspace = vscode.workspace.workspaceFolders![0].uri.fsPath;
    folderUri = vscode.workspace.workspaceFolders![0].uri.toString();
    // The TypeScript server finds the references in every file of a project it knows.
    writeFile("tsconfig.json", JSON.stringify({ compilerOptions: { target: "es2022", module: "commonjs", strict: false }, include: ["**/*.ts"] }));
    writeFile("src/shop/broad.ts", broadFile());
    writeFile("src/shop/index.ts", "export { Shop } from './broad';\nexport * from './broad';\n");
    writeFile("apps/web/page.ts", `import { Shop } from '../../src/shop';\nimport { post } from '../../src/ledger/ledger';\nconst shop = new Shop();\n${calls("shop", methods.slice(0, 4))}\npost();\n`);
    writeFile("packages/billing/charge.ts", `import * as shop from '../../src/shop/broad';\nimport { balance } from '../../src/ledger/ledger';\nconst s = new shop.Shop();\n${calls("s", methods.slice(4, 8))}\nbalance();\n`);
    writeFile("src/admin/panel.ts", `import { Shop as Store } from '../shop/broad';\nconst s = new Store();\n${calls("s", methods.slice(8))}\n`);
    // A module in disguise: one exported object whose members other files call.
    writeFile("src/shop/api.ts", `export const api = {\n${methods.map((name) => `  ${name}(): number {\n    return 1;\n  },`).join("\n")}\n  helper: 1,\n};\nexport namespace tools {\n  export function sweep(): void {}\n  export function count(): number { return 0; }\n}\n`);
    writeFile("apps/web/api-user.ts", `import { api, tools } from '../../src/shop/api';\n${calls("api", methods.slice(0, 4))}\ntools.sweep();\n`);
    writeFile("src/shop/broad.test.ts", "import { Shop } from './broad';\nnew Shop().method1();\n");
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
    // Every file is a candidate, so the barrel and the users are measured too.
    await vscode.workspace.getConfiguration("reviewGuide.godFiles").update("minLines", 1, vscode.ConfigurationTarget.Global);
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
    await waitFor(() => fileNodes().every((node) => node.item.breadth.state !== "pending" && node.item.complexity.state !== "pending"), "breadth and complexity are measured", 120_000);
  });

  after(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  it("G3: breadth comes from the TypeScript server: class members through a barrel, a namespace import and an alias; the barrel has no names of its own; tests are not users", () => {
    const broad = nodeOf("src/shop/broad.ts").item.breadth;
    if (broad.state !== "known") {
      assert.fail(JSON.stringify(broad));
    }
    assert.strictEqual(broad.complete, false, "it stops counting above 7 names");
    assert.deepStrictEqual(broad.names, ["Shop", ...methods.slice(0, 7).map((name) => `Shop.${name}`)].sort(), "the class and its members in the order they are declared; the private one never");
    assert.deepStrictEqual(broad.files, ["apps/web/page.ts", "packages/billing/charge.ts", "src/admin/panel.ts"], "the barrel and the test are no users");
    assert.deepStrictEqual(nodeOf("src/shop/index.ts").item.breadth, { state: "known", names: [], files: [], complete: true }, "a barrel re-exports, it declares nothing of its own");
    assert.deepStrictEqual(nodeOf("src/ledger/ledger.ts").item.breadth, { state: "known", names: ["balance", "post"], files: ["apps/web/page.ts", "packages/billing/charge.ts"], complete: true });
  });

  it("G3: the members of an exported object and of a namespace count like class members: a module in disguise is broad", () => {
    const expected = { state: "known", names: ["api", ...methods.slice(0, 4).map((name) => `api.${name}`), "tools", "tools.sweep"].sort(), files: ["apps/web/api-user.ts"], complete: true };
    assert.deepStrictEqual(nodeOf("src/shop/api.ts").item.breadth, expected, "the object, its called methods, the namespace and its called function; api.helper and tools.count are used by nobody");
  });

  it("G5: shows the files with the numbers line and hints, and writes nothing into the repo", async () => {
    const before = fingerprint(workspace);
    const broad = api.godFilesView.getTreeItem(nodeOf("src/shop/broad.ts"));
    assert.strictEqual(plain(String(broad.label)), "⚠ 💰🧠 src/shop/broad.ts", "the mark, the codemap badge and the path");
    assert.match(String(broad.description), /^⚠️ codemap says deep · god file\? · 8\+ names used outside · 4 commits\/90 d · changes with 3 areas · knows 0 areas · \d+ lines$/, "apps/web, packages/billing and src/admin; not src/shop, its own area (the barrel)");
    const ledger = api.godFilesView.getTreeItem(nodeOf("src/ledger/ledger.ts"));
    assert.strictEqual(ledger.label, "✓ src/ledger/ledger.ts");
    assert.strictEqual(ledger.description, "deep · 2 names used outside · 1 commit/90 d · changes with 0 areas · knows 0 areas · 605 lines");
    assert.match(String(api.godFilesView.getTreeItem(nodeOf("apps/web/page.ts")).description), /· knows 2 areas ·/, "page.ts imports from src/shop and src/ledger");
    assert.ok(api.godFilesView.message?.includes("ranked by history and imports, never by length"), api.godFilesView.message);
    assert.strictEqual(fingerprint(workspace), before, "no byte in the repo (its .git and .codemap included) changed");
    assert.strictEqual(git(workspace, "status", "--porcelain"), "", "no new file in the repo");
  });

  it("G5, G6: the tooltip explains each number, the hardest function and the owner's rule, and warns that the codemap calls a broad file deep", () => {
    const node = nodeOf("src/shop/broad.ts");
    const item = api.godFilesView.resolveTreeItem(api.godFilesView.getTreeItem(node), node);
    const tooltip = (item.tooltip as vscode.MarkdownString).value.replace(/\\(.)/g, "$1");
    for (const part of ["Your codemap calls this file a deep module, but more than 7 of its names are used by other files", "Codemap: 💰", "8+ names used outside:", "Counting stopped above 7", "4 commits in 90 days", "Hardest function:** hardest, cognitive complexity", "A big file is fine only as a well-designed deep module", "command:reviewGuide.godFiles.judge"]) {
      assert.ok(tooltip.includes(part), `${part}\n---\n${tooltip}`);
    }
  });

  it("G5: a click opens the file at its hardest function", async () => {
    const node = nodeOf("src/shop/broad.ts");
    const command = api.godFilesView.getTreeItem(node).command!;
    assert.strictEqual(command.title, "Open at the hardest function (hardest)");
    await vscode.commands.executeCommand(command.command, ...(command.arguments ?? []));
    const hardestLine = broadFile().split("\n").findIndex((line) => line.startsWith("export function hardest("));
    await waitFor(() => vscode.window.activeTextEditor?.document.uri.fsPath === path.join(workspace, "src/shop/broad.ts") && vscode.window.activeTextEditor.selection.active.line === hardestLine, `the cursor is on line ${hardestLine + 1}, hardest`, 30_000);
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
    const node = nodeOf("src/shop/broad.ts");
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

  function nodeOf(repoPath: string): FileNode {
    const node = fileNodes().find((candidate) => candidate.path === repoPath);
    assert.ok(node, `${repoPath} is shown: ${fileNodes().map((candidate) => candidate.path).join(", ")}`);
    return node;
  }

  function fileNodes(): FileNode[] {
    return api.godFilesView.getChildren().filter((node): node is FileNode => node.kind === "file");
  }

  function reportCommit(): string | undefined {
    return api.godFilesView.measured({ folderUri, path: "src/ledger/ledger.ts" })?.report.commit;
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
