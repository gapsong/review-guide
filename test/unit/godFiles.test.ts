import * as assert from "assert";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { Breadth, LanguageServer, measureBreadth, SymbolNode } from "../../src/godfiles/breadth";
import { areaOf, defaultGodFileOptions, GodFileItem, GodFileReport, hintOf, measureGodFiles, readFilesAt } from "../../src/godfiles/godFiles";
import { importedFiles, importLinesOf } from "../../src/godfiles/imports";
import { countCodeLines, globToRegExp, isMeasuredSource } from "../../src/godfiles/sourceFiles";
import { fingerprint, makeTempDir } from "../support/gitFixture";
import { commitFilesAt, filler, initRepo } from "../support/historyFixture";

function itemOf(report: GodFileReport, filePath: string): GodFileItem {
  const item = report.items.find((candidate) => candidate.path === filePath);
  assert.ok(item, `${filePath} is a candidate: ${report.items.map((candidate) => candidate.path).join(", ")}`);
  return item;
}

function exportedFunctions(names: string[], linesEach: number): string {
  return names.map((name) => `export function ${name}(): void {\n${filler(linesEach, name)}\n}\n`).join("\n");
}

const broadNames = Array.from({ length: 12 }, (_, index) => `broad${index + 1}`);

// The fixture of G2: a broad file that 3 areas use and change with, and a long module with a
// narrow interface that changes on its own.
function writeG2Repo(repo: string, ledgerLines = 600): void {
  initRepo(repo);
  commitFilesAt(repo, 100, {
    "src/shop/broad.ts": exportedFunctions(broadNames, 12),
    "src/ledger/ledger.ts": `export function post(): void {\n${filler(ledgerLines / 2, "postStep")}\n}\nexport function balance(): number {\n${filler(ledgerLines / 2 - 6, "balanceStep")}\n  return 0;\n}\nfunction hidden(): void {}\n`,
    "src/long/table.ts": `const rows = [\n${filler(5000, "row")}\n];\nfunction lookup(): void {}\n`,
    "apps/web/page.ts": `import { broad1, broad2, broad3, broad4 } from "../../src/shop/broad";\nimport { post } from "@/ledger/ledger";\n`,
    "packages/billing/charge.ts": `import { broad5, broad6, broad7, broad8 } from "../../src/shop/broad";\nimport { balance } from "../../src/ledger/ledger";\n`,
    "src/admin/panel.ts": `import * as shop from "../shop/broad";\nshop.broad9(); shop.broad10(); shop.broad11(); shop.broad12();\nimport { post, balance } from "../ledger/ledger";\n`,
    "src/ledger/journal.ts": "export const journal = 1;\n",
  }, "Start, before the window");
  for (const [days, partner] of [[60, "apps/web/page.ts"], [40, "packages/billing/charge.ts"], [20, "src/admin/panel.ts"], [10, "apps/web/page.ts"]] as const) {
    const broad = fs.readFileSync(path.join(repo, "src/shop/broad.ts"), "utf8");
    const partnerText = fs.readFileSync(path.join(repo, partner), "utf8");
    commitFilesAt(repo, days, { "src/shop/broad.ts": `${broad}// ${days}\n`, [partner]: `${partnerText}// ${days}\n` }, `Change broad with ${partner}`);
  }
  const ledger = fs.readFileSync(path.join(repo, "src/ledger/ledger.ts"), "utf8");
  commitFilesAt(repo, 5, { "src/ledger/ledger.ts": `${ledger}// 5\n`, "src/ledger/journal.ts": "export const journal = 2;\n" }, "Change the ledger");
}

describe("G1: the measurement is deterministic and read-only", () => {
  let scratch: string;
  let repo: string;

  before(() => {
    scratch = makeTempDir("godfiles-g1");
    repo = path.join(scratch, "repo");
    writeG2Repo(repo);
    commitFilesAt(repo, 1, {
      "tests/test_shop.py": `${filler(200)}\n`,
      "src/shop/broad.test.ts": `${filler(200)}\n`,
      "src/shop/conftest.py": `${filler(200)}\n`,
      "web/node_modules/lib/index.js": `${filler(200)}\n`,
      "dist/bundle.js": `${filler(200)}\n`,
      "src/generated/api.ts": `${filler(200)}\n`,
      "src/types.d.ts": `${filler(200)}\n`,
      "vendor/lib.min.js": `${filler(200)}\n`,
      "src/legacy/old.ts": `${filler(200)}\n`,
    }, "Tests, generated and vendored code");
  });

  after(() => fs.rmSync(scratch, { recursive: true, force: true }));

  it("G1: gives the same report twice, changes no byte of the repo, and ignores the working tree", async () => {
    const before = fingerprint(repo);
    const first = await measureGodFiles(repo, defaultGodFileOptions);
    fs.writeFileSync(path.join(repo, "src/shop/broad.ts"), "// an edit that is not committed\n");
    fs.writeFileSync(path.join(repo, "src/untracked.ts"), `${filler(400)}\n`);
    const second = await measureGodFiles(repo, defaultGodFileOptions);
    assert.deepStrictEqual(second, first, "only HEAD and its history count");
    fs.writeFileSync(path.join(repo, "src/shop/broad.ts"), execGitShow(repo, "HEAD:src/shop/broad.ts"));
    fs.rmSync(path.join(repo, "src/untracked.ts"));
    assert.strictEqual(fingerprint(repo), before, "no byte in the repo, .git included, changed");
  });

  it("G1: leaves out tests, generated and vendored code, and the globs of the exclude setting", async () => {
    const report = await measureGodFiles(repo, { ...defaultGodFileOptions, exclude: ["src/legacy/**"] });
    assert.deepStrictEqual(report.items.map((item) => item.path).sort(), ["src/ledger/ledger.ts", "src/long/table.ts", "src/shop/broad.ts"]);
    const withoutSetting = await measureGodFiles(repo, defaultGodFileOptions);
    assert.ok(withoutSetting.items.some((item) => item.path === "src/legacy/old.ts"), "without the glob the file is measured");
  });

  it("G1: decides which paths are tests, generated or vendored", () => {
    const measured = (repoPath: string) => isMeasuredSource(repoPath, []);
    for (const leftOut of ["tests/a.py", "src/test/a.ts", "a/__tests__/b.tsx", "spec/a.rb", "e2e/run.ts", "pkg/test_a.py", "pkg/a_test.py", "pkg/a_test.go", "a.test.ts", "a.spec.js", "conftest.py",
      "node_modules/x/index.js", "dist/a.js", "build/a.js", "src/generated/a.ts", "__generated__/a.ts", "vendor/a.go", "types.d.ts", "a.min.js", "README.md", "data.json"]) {
      assert.strictEqual(measured(leftOut), false, leftOut);
    }
    for (const kept of ["src/a.ts", "app/b.py", "cmd/main.go", "lib/x.rs", "contest.py", "src/testing.ts", "src/latest.ts"]) {
      assert.strictEqual(measured(kept), true, kept);
    }
    assert.strictEqual(isMeasuredSource("src/legacy/a/b.ts", [globToRegExp("src/legacy/**")]), false);
    assert.strictEqual(isMeasuredSource("deep/down/schema_pb2.py", [globToRegExp("*_pb2.py")]), false, "a glob without / matches a file name anywhere");
    assert.strictEqual(isMeasuredSource("docs_src/a.ts", [globToRegExp("docs_src/**")]), false);
    assert.strictEqual(isMeasuredSource("src/docs_src.ts", [globToRegExp("docs_src/**")]), true);
  });
});

describe("G2: the ranking follows the owner's rule", () => {
  let scratch: string;

  before(() => {
    scratch = makeTempDir("godfiles-g2");
  });

  after(() => fs.rmSync(scratch, { recursive: true, force: true }));

  it("G2: ranks a broad file (12 names used by other files, co-changing across 3 areas) above a 600-line module with 2 names used outside, which carries the deep hint", async () => {
    const repo = path.join(scratch, "repo");
    writeG2Repo(repo);
    const report = await measureGodFiles(repo, defaultGodFileOptions);
    const broad = itemOf(report, "src/shop/broad.ts");
    const ledger = itemOf(report, "src/ledger/ledger.ts");
    assert.deepStrictEqual(broad.coChangeAreas, ["apps/web", "packages/billing", "src/admin"]);
    assert.ok(ledger.codeLines >= 600, `the ledger has ${ledger.codeLines} code lines`);
    assert.ok(broad.codeLines < ledger.codeLines, "the broad file is the shorter one");
    assert.deepStrictEqual(report.items.map((item) => item.path), ["src/shop/broad.ts", "src/ledger/ledger.ts", "src/long/table.ts"]);
    assert.strictEqual(broad.breadth.state, "pending", "breadth comes later, from the language server");
    assert.strictEqual(hintOf({ ...broad, breadth: known(broadNames) }), "god file?");
    assert.strictEqual(hintOf({ ...ledger, breadth: known(["balance", "post"]) }), "deep");
  });

  it("G2: length alone never lifts a file: ten times the lines leave its score and rank as they were", async () => {
    const shortRepo = path.join(scratch, "short");
    const longRepo = path.join(scratch, "long");
    writeG2Repo(shortRepo, 600);
    writeG2Repo(longRepo, 6000);
    const short = await measureGodFiles(shortRepo, defaultGodFileOptions);
    const long = await measureGodFiles(longRepo, defaultGodFileOptions);
    assert.ok(itemOf(long, "src/ledger/ledger.ts").codeLines > 10 * 590);
    assert.strictEqual(itemOf(long, "src/ledger/ledger.ts").score, itemOf(short, "src/ledger/ledger.ts").score);
    assert.deepStrictEqual(long.items.map((item) => item.path), short.items.map((item) => item.path));
    assert.strictEqual(short.items[short.items.length - 1].path, "src/long/table.ts", "the 5000-line file that nobody uses ranks last");
  });

  it("G2: the hint is 'god file?' above 7 names used outside; 'deep' needs 1 to 7 names, 300 code lines, at most 3 co-change areas and at most 3 known areas; none when breadth is unknown, pending or nothing uses the file", () => {
    const areas = (count: number) => Array.from({ length: count }, (_, index) => `area${index}`);
    const hint = (names: number | undefined, codeLines: number, coChange: number, knownAreas = 0, complete = true) => hintOf({
      breadth: names === undefined ? { state: "unknown", reason: "no server" } : { ...known(areas(names)), complete },
      codeLines,
      coChangeAreas: areas(coChange),
      knownAreas: areas(knownAreas),
    });
    assert.strictEqual(hint(8, 10, 0), "god file?");
    assert.strictEqual(hint(8, 10, 12), "god file?", "the count stopped at 8 (\"8+\") is broad too");
    assert.strictEqual(hint(8, 10, 0, 0, false), "god file?");
    assert.strictEqual(hint(7, 300, 3), "deep");
    assert.strictEqual(hint(7, 300, 3, 3), "deep");
    assert.strictEqual(hint(7, 300, 3, 4), undefined, "narrow, but it knows 4 other areas");
    assert.strictEqual(hint(7, 299, 3), undefined, "too short for a deep module");
    assert.strictEqual(hint(7, 300, 4), undefined, "narrow but changing with many areas: many reasons to change");
    assert.strictEqual(hint(0, 5000, 0), undefined, "nothing uses it: an entry point or unused, not a deep module");
    assert.strictEqual(hint(undefined, 5000, 0), undefined);
    assert.strictEqual(hintOf({ breadth: { state: "pending" }, codeLines: 5000, coChangeAreas: [], knownAreas: [] }), undefined);
  });

  it("G2: a long narrow file that changes with 6 areas gets no deep hint", async () => {
    const repo = path.join(scratch, "unstable");
    writeG2Repo(repo);
    for (const [days, partner] of [[50, "apps/web/page.ts"], [45, "packages/billing/charge.ts"], [35, "src/admin/panel.ts"], [25, "src/shop/broad.ts"]] as const) {
      const ledger = fs.readFileSync(path.join(repo, "src/ledger/ledger.ts"), "utf8");
      const partnerText = fs.readFileSync(path.join(repo, partner), "utf8");
      commitFilesAt(repo, days, { "src/ledger/ledger.ts": `${ledger}// ledger ${days}\n`, [partner]: `${partnerText}// ledger ${days}\n` }, `Change the ledger with ${partner}`);
    }
    const ledger = itemOf(await measureGodFiles(repo, defaultGodFileOptions), "src/ledger/ledger.ts");
    assert.deepStrictEqual(ledger.coChangeAreas, ["apps/web", "packages/billing", "src/admin", "src/ledger", "src/long", "src/shop"]);
    assert.strictEqual(hintOf({ ...ledger, breadth: known(["balance", "post"]) }), undefined);
  });

  it("G2: a file that imports from 11 other areas knows them all and ranks first, before anything uses it", async () => {
    const repo = path.join(scratch, "knows");
    initRepo(repo);
    const areas = Array.from({ length: 11 }, (_, index) => `area${index}`);
    const files: Record<string, string> = {
      "app/main.py": `${areas.map((area) => `from ${area}.service import run_${area}`).join("\n")}\nimport os\nfrom .local import x\n${filler(200)}\n`,
      "app/local.py": "x = 1\n",
      "lib/quiet.py": `${filler(200)}\n`,
    };
    for (const area of areas) {
      files[`${area}/service.py`] = `def run_${area}():\n    pass\n`;
    }
    commitFilesAt(repo, 10, files);
    const report = await measureGodFiles(repo, defaultGodFileOptions);
    assert.deepStrictEqual(itemOf(report, "app/main.py").knownAreas, [...areas].sort(), "its own area, os and packages outside the repo do not count");
    assert.deepStrictEqual(itemOf(report, "lib/quiet.py").knownAreas, []);
    assert.strictEqual(report.items[0].path, "app/main.py");
  });

  it("G2: a route module that the app imports and uses only as m.router over a tuple of modules is imported, even with no name use", async () => {
    const repo = path.join(scratch, "routes");
    initRepo(repo);
    commitFilesAt(repo, 10, {
      "app/routes/users.py": `from fastapi import APIRouter\n\nrouter = APIRouter()\n${filler(200)}\n`,
      "app/main.py": "from app.routes import users, orders\n\nrouters = [m.router for m in (users, orders)]\n",
      "app/routes/orders.py": "router = 1\n",
    });
    const report = await measureGodFiles(repo, defaultGodFileOptions);
    assert.deepStrictEqual(itemOf(report, "app/routes/users.py").importedBy, ["app/main.py"]);
  });

  it("G2: candidates start at the minimum of code lines (150 by default)", async () => {
    const repo = path.join(scratch, "threshold");
    initRepo(repo);
    commitFilesAt(repo, 1, { "a.ts": `${filler(150)}\n`, "b.ts": `${filler(149)}\n// a comment\n\n` });
    const report = await measureGodFiles(repo, defaultGodFileOptions);
    assert.deepStrictEqual(report.items.map((item) => item.path), ["a.ts"]);
    const lower = await measureGodFiles(repo, { ...defaultGodFileOptions, minCodeLines: 100 });
    assert.deepStrictEqual(lower.items.map((item) => item.path).sort(), ["a.ts", "b.ts"]);
  });
});

describe("G3: the module-level import scan (knows N areas)", () => {
  it("G3: TypeScript and JavaScript: import, multi-line import, export from, require, dynamic import, relative paths with extensions and index files, path aliases; packages and comments are not imports", () => {
    const sources = [
      ts("src/lib/money.ts", "export const cents = 1;\n"),
      ts("src/lib/index.ts", "export { cents } from './money';\nexport * from './tax';\n"),
      ts("src/lib/tax.ts", "export const vat = 1;\n"),
      ts("src/util/log.js", "exports.log = 1;\n"),
      ts("apps/web/a.ts", "import {\n  cents as c,\n  type Price,\n} from '../../src/lib/money';\n// import { x } from '../../src/util/log';\nimport React from 'react';\nimport { y } from 'money';\n"),
      ts("apps/web/b.tsx", "import * as m from '@/lib/money';\n"),
      ts("apps/web/c.js", "const { log } = require('../../src/util/log.js');\n"),
      ts("apps/web/d.mjs", "const { vat } = await import('~/lib/tax.js');\n"),
      ts("apps/web/e.ts", "import { vat } from '../../src/lib';\nimport './side-effect';\n"),
      ts("apps/web/side-effect.ts", "\n"),
    ];
    const imported = importedFiles(sources);
    assert.deepStrictEqual(imported.get("apps/web/a.ts"), ["src/lib/money.ts"], "a multi-line import; the commented-out one and the packages are not imports");
    assert.deepStrictEqual(imported.get("apps/web/b.tsx"), ["src/lib/money.ts"], "an alias is resolved by path suffix");
    assert.deepStrictEqual(imported.get("apps/web/c.js"), ["src/util/log.js"]);
    assert.deepStrictEqual(imported.get("apps/web/d.mjs"), ["src/lib/tax.ts"]);
    assert.deepStrictEqual(imported.get("apps/web/e.ts"), ["apps/web/side-effect.ts", "src/lib/index.ts"]);
    assert.deepStrictEqual(imported.get("src/lib/index.ts"), ["src/lib/money.ts", "src/lib/tax.ts"]);
    assert.deepStrictEqual([...importLinesOf(sources[4].text, "typescript")].sort(), [0, 1, 2, 3, 5, 6], "the lines of the statements, not the comment");
  });

  it("G3: Python: from pkg import module, import a.b as c, relative imports, parenthesised and continued lists; a docstring's import is not one", () => {
    const sources = [
      py("app/routes/billing.py", "router = 1\n"),
      py("app/routes/__init__.py", "\n"),
      py("app/models.py", "class Order: pass\n"),
      py("shop/payment.py", "def charge(): pass\n"),
      py("api/main.py", "from app.routes import billing\nbilling.router\n"),
      py("api/admin.py", "import app.models as m\nfrom ..shop import payment\n"),
      py("api/jobs.py", "from app.models import (\n    Order,\n)\nfrom shop.payment \\\n    import charge\n\"\"\"from app.routes import billing\"\"\"\n"),
    ];
    const imported = importedFiles(sources);
    assert.deepStrictEqual(imported.get("api/main.py"), ["app/routes/billing.py"], "from a package, a module is the import");
    assert.deepStrictEqual(imported.get("api/admin.py"), ["app/models.py", "shop/payment.py"]);
    assert.deepStrictEqual(imported.get("api/jobs.py"), ["app/models.py", "shop/payment.py"]);
    assert.deepStrictEqual([...importLinesOf(sources[6].text, "python")].sort(), [0, 1, 2, 3, 4]);
  });

  it("G3: a string with \"from\", a declaration before a re-export or a template is no import line; a re-export without from and __all__ are", () => {
    const typescriptLines = (text: string) => [...importLinesOf(text, "typescript")].sort((first, second) => first - second);
    assert.deepStrictEqual(typescriptLines("export const label = \"copy from\";\nexport function f(a = \"from\") {}\n"), []);
    assert.deepStrictEqual(typescriptLines("export enum Color {\n  Red,\n  Green,\n}\nexport * from \"./x\";\n"), [4]);
    assert.deepStrictEqual(typescriptLines("export function run() {\n  a()\n}\nexport { c } from \"./c\"\n"), [3]);
    assert.deepStrictEqual(typescriptLines("import { x } from \"./a\";\nexport { x };\nexport default x;\n"), [0, 1], "a barrel that imports and then exports");
    assert.deepStrictEqual(typescriptLines("\uFEFFimport { x } from \"./a\";\r\nimport type {\r\n  T,\r\n} from \"./t\";\r\n"), [0, 1, 2, 3], "a byte order mark and CRLF");
    const pythonLines = (text: string) => [...importLinesOf(text, "python")].sort((first, second) => first - second);
    assert.deepStrictEqual(pythonLines("from .a import b\n__all__ = [\n    \"b\",\n]\nx = 1\n"), [0, 1, 2, 3]);
    assert.deepStrictEqual(pythonLines("from a \\\r\n    import b\r\nx = 1\r\n"), [0, 1], "a CRLF continuation");
  });

  it("G3: an import that two files of the same suffix could mean is not resolved, unless one shares more folders", () => {
    const imported = importedFiles([
      ts("packages/a/src/util/log.ts", "export function log() {}\n"),
      ts("packages/b/src/util/log.ts", "export function log() {}\n"),
      ts("packages/a/src/main.ts", "import { log } from 'src/util/log';\n"),
      ts("apps/x.ts", "import { log } from 'src/util/log';\n"),
    ]);
    assert.deepStrictEqual(imported.get("packages/a/src/main.ts"), ["packages/a/src/util/log.ts"]);
    assert.deepStrictEqual(imported.get("apps/x.ts"), []);
  });
});

describe("G3: breadth from the language server (a fake one)", () => {
  const measured = new Set(["src/github/model.ts", "src/github/index.ts", "src/view/tree.ts", "src/commands.ts", "src/webview.ts", "src/lib/money.ts", "src/lib/index.ts", "apps/web/f.ts", "apps/web/g.ts", "app/routes/billing.py", "app/main.py", "cmd/main.go"]);
  const options = { measured, stopAbove: 100, timeoutMilliseconds: 5_000, isCancelled: () => false };

  // Model: a class with 12 public methods, each used by another file, and members that never count.
  const hiddenMembers = ["private secret = 1;", "protected guarded(): void {}", "#hidden(): void {}", "_internal(): void {}", "constructor(public readonly id: string) {}"];
  const modelLines = ["export class Model {", ...hiddenMembers.map((line) => `  ${line}`), ...Array.from({ length: 12 }, (_, index) => `  method${index + 1}(): void {}`), "  unused(): void {}", "}", "function helper(): void {}"];
  const memberNames = ["secret", "guarded", "#hidden", "_internal", "constructor", ...Array.from({ length: 12 }, (_, index) => `method${index + 1}`), "unused"];
  const model = fakeFile("src/github/model.ts", modelLines, [
    symbol("Model", 0, memberNames.map((name, index) => symbol(name, index + 1))),
    symbol("helper", modelLines.length - 1),
  ]);

  it("G3: a class with 12 public methods that other files call is broad: members count as \"Class.member\"; private, protected, #, _, the constructor and members nobody calls do not", async () => {
    const users = ["src/view/tree.ts", "src/commands.ts", "src/webview.ts"];
    const references: Record<string, Use[]> = { "src/github/model.ts:0": [{ path: "src/view/tree.ts", line: 3 }] };
    for (let index = 1; index <= 12; index++) {
      references[`src/github/model.ts:${modelLines.indexOf(`  method${index}(): void {}`)}`] = [{ path: users[index % 3], line: index }];
    }
    for (const hidden of [1, 2, 3, 4]) {
      references[`src/github/model.ts:${hidden}`] = [{ path: "src/view/tree.ts", line: 20 + hidden }];
    }
    references[`src/github/model.ts:${modelLines.length - 1}`] = [{ path: "src/github/model.ts", line: 3 }];
    const server = fakeServer([model, ...users.map((user) => fakeFile(user, ["import { Model } from '../github/model';"], []))], references);
    const breadth = await measureBreadth("src/github/model.ts", server, options);
    const methods = Array.from({ length: 12 }, (_, index) => `Model.method${index + 1}`);
    assert.deepStrictEqual(breadth, { state: "known", names: ["Model", ...methods].sort(), files: [...users].sort(), complete: true });
    const stopped = await measureBreadth("src/github/model.ts", server, { ...options, stopAbove: 7 });
    assert.ok(stopped?.state === "known" && !stopped.complete && stopped.names.length === 8, `stops at 8 names ("8+"): ${JSON.stringify(stopped)}`);
  });

  it("G3: same-file references and references from tests or files outside the measured set are not uses", async () => {
    const lines = ["export function charge() {}", "charge();"];
    const server = fakeServer([fakeFile("src/lib/money.ts", lines, [symbol("charge", 0)])], {
      "src/lib/money.ts:0": [{ path: "src/lib/money.ts", line: 0 }, { path: "src/lib/money.ts", line: 1 }, { path: "test/money.test.ts", line: 2 }, { path: undefined, line: 3 }],
    });
    assert.deepStrictEqual(await measureBreadth("src/lib/money.ts", server, options), { state: "known", names: [], files: [], complete: true });
  });

  it("G3: a barrel counts no re-exported name as its own, and is no user either: the defining module gets the use", async () => {
    const money = fakeFile("src/lib/money.ts", ["export function add() {}", "export const cents = 1;"], [symbol("add", 0), symbol("cents", 1)]);
    const barrel = fakeFile("src/lib/index.ts", ["export { add } from './money';", "export {", "  cents,", "} from './money';"], [symbol("add", 0), symbol("cents", 2)]);
    const user = fakeFile("apps/web/f.ts", ["import { add } from '../../src/lib';", "add();"], []);
    const server = fakeServer([money, barrel, user], {
      "src/lib/money.ts:0": [{ path: "src/lib/money.ts", line: 0 }, { path: "src/lib/index.ts", line: 0 }, { path: "apps/web/f.ts", line: 0 }, { path: "apps/web/f.ts", line: 1 }],
      "src/lib/money.ts:1": [{ path: "src/lib/money.ts", line: 1 }, { path: "src/lib/index.ts", line: 2 }],
      "src/lib/index.ts:0": [{ path: "apps/web/f.ts", line: 1 }],
      "src/lib/index.ts:2": [{ path: "apps/web/f.ts", line: 1 }],
    });
    assert.deepStrictEqual(await measureBreadth("src/lib/money.ts", server, options), { state: "known", names: ["add"], files: ["apps/web/f.ts"], complete: true });
    assert.deepStrictEqual(await measureBreadth("src/lib/index.ts", server, options), { state: "known", names: [], files: [], complete: true });
  });

  it("G3: module.attr, an aliased import and a namespace import are uses of the defining file", async () => {
    const billing = fakeFile("app/routes/billing.py", ["from fastapi import APIRouter", "", "router = APIRouter()", "def _private(): pass"], [symbol("APIRouter", 0), symbol("router", 2), symbol("_private", 3)]);
    const main = fakeFile("app/main.py", ["from app.routes import billing", "", "app.include_router(billing.router)"], []);
    const money = fakeFile("src/lib/money.ts", ["export const cents = 1;", "export function add() {}"], [symbol("cents", 0), symbol("add", 1)]);
    const aliased = fakeFile("apps/web/f.ts", ["import { cents as c } from '@/lib/money';", "c + 1;"], []);
    const namespace = fakeFile("apps/web/g.ts", ["import * as m from '../../src/lib/money';", "m.add();"], []);
    const server = fakeServer([billing, main, money, aliased, namespace], {
      "app/routes/billing.py:0": [{ path: "app/routes/billing.py", line: 0 }],
      "app/routes/billing.py:2": [{ path: "app/routes/billing.py", line: 2 }, { path: "app/main.py", line: 2 }],
      "src/lib/money.ts:0": [{ path: "src/lib/money.ts", line: 0 }, { path: "apps/web/f.ts", line: 0 }, { path: "apps/web/f.ts", line: 1 }],
      "src/lib/money.ts:1": [{ path: "src/lib/money.ts", line: 1 }, { path: "apps/web/g.ts", line: 1 }],
    });
    assert.deepStrictEqual(await measureBreadth("app/routes/billing.py", server, options), { state: "known", names: ["router"], files: ["app/main.py"], complete: true }, "billing.router is a use; the imported APIRouter is not billing's own name");
    assert.deepStrictEqual(await measureBreadth("src/lib/money.ts", server, options), { state: "known", names: ["add", "cents"], files: ["apps/web/f.ts", "apps/web/g.ts"], complete: true });
  });

  it("G3: \"constructor(private a: A, public b: B)\" hides a, not b", async () => {
    const lines = ["export class Api {", "  constructor(private readonly http: Http, public dialog: Dialog) {}", "  private cache = 1; size = 2;", "}"];
    const server = fakeServer([fakeFile("src/lib/money.ts", lines, [symbol("Api", 0, [symbol("http", 1), symbol("dialog", 1), symbol("cache", 2), symbol("size", 2)])])], {
      "src/lib/money.ts:1": [{ path: "apps/web/f.ts", line: 4 }],
      "src/lib/money.ts:2": [{ path: "apps/web/f.ts", line: 5 }],
    });
    assert.deepStrictEqual(await measureBreadth("src/lib/money.ts", server, options), { state: "known", names: ["Api.dialog", "Api.size"], files: ["apps/web/f.ts"], complete: true });
  });

  it("G3: references that never map back to the file itself make breadth unknown, not 0", async () => {
    const elsewhere: LanguageServer = { ...fakeServer([fakeFile("src/lib/money.ts", ["export const cents = 1;"], [symbol("cents", 0)])], {}), references: async () => [{ path: undefined, line: 0 }] };
    assert.deepStrictEqual(await measureBreadth("src/lib/money.ts", elsewhere, options), { state: "unknown", reason: "The language server's references do not map back to the files of this workspace folder." });
  });

  it("G3: unknown breadth is never 0: no symbol provider, no reference provider, a timeout and a failure each give a reason; a cancel gives nothing", async () => {
    const go = fakeServer([fakeFile("cmd/main.go", ["package main", "func Run() {}"], undefined)], {});
    const unknown = await measureBreadth("cmd/main.go", go, options);
    assert.deepStrictEqual(unknown, { state: "unknown", reason: "No language server answers document symbols for \".go\" files here." });
    const noReferences: LanguageServer = { ...fakeServer([fakeFile("src/lib/money.ts", ["export const cents = 1;"], [symbol("cents", 0)])], {}), references: async () => [] };
    assert.deepStrictEqual(await measureBreadth("src/lib/money.ts", noReferences, options), { state: "unknown", reason: "No language server answers references for TypeScript/JavaScript files here." });
    const slow: LanguageServer = { ...noReferences, references: () => new Promise(() => undefined) };
    assert.deepStrictEqual(await measureBreadth("src/lib/money.ts", slow, { ...options, timeoutMilliseconds: 50 }), { state: "unknown", reason: "The language server did not answer within 0 s." });
    const someAnswered: LanguageServer = { ...fakeServer([fakeFile("src/lib/money.ts", ["export const cents = 1;", "export const euros = 2;"], [symbol("cents", 0), symbol("euros", 1)])], { "src/lib/money.ts:1": [{ path: "apps/web/f.ts", line: 3 }] }) };
    const firstUnanswered: LanguageServer = { ...someAnswered, references: async (repoPath, line, character) => (line === 0 ? [] : someAnswered.references(repoPath, line, character)) };
    assert.deepStrictEqual(await measureBreadth("src/lib/money.ts", firstUnanswered, options), { state: "known", names: ["euros"], files: ["apps/web/f.ts"], complete: true }, "one declaration without an answer does not make the file unknown");
    const failing: LanguageServer = { ...noReferences, references: () => Promise.reject(new Error("crashed")) };
    assert.deepStrictEqual(await measureBreadth("src/lib/money.ts", failing, options), { state: "unknown", reason: "The language server failed: crashed" });
    assert.strictEqual(await measureBreadth("src/lib/money.ts", noReferences, { ...options, isCancelled: () => true }), undefined);
  });
});

describe("G4: history from one git log pass", () => {
  let scratch: string;
  let repo: string;
  let report: GodFileReport;

  before(async () => {
    scratch = makeTempDir("godfiles-g4");
    repo = path.join(scratch, "repo");
    initRepo(repo);
    const big = `${filler(200)}\n`;
    commitFilesAt(repo, 120, { "src/core/engine.ts": big, "apps/api/old.ts": "export const old = 1;\n" }, "Before the window");
    commitFilesAt(repo, 80, { "src/core/engine.ts": `${big}// 80\n`, "apps/api/routes.ts": "export const r = 1;\n" }, "Inside the window, not recent");
    commitFilesAt(repo, 25, { "src/core/engine.ts": `${big}// 25\n`, "packages/ui/button.ts": "export const b = 1;\n", "README.md": "readme\n", "src/core/engine.test.ts": "test\n" }, "Recent");
    const sweep: Record<string, string> = { "src/core/engine.ts": `${big}// sweep\n` };
    for (let index = 0; index < 30; index++) {
      sweep[`services/s${index}/file.ts`] = `export const s${index} = 1;\n`;
    }
    commitFilesAt(repo, 10, sweep, "A sweep of 31 files");
    commitFilesAt(repo, 5, { "src/core/engine.ts": null, "src/core/motor.ts": `${big}// 25\n` }, "Rename");
    commitFilesAt(repo, 2, { "src/core/motor.ts": `${big}// 2\n`, "src/core/helper.ts": "export const h = 1;\n" }, "After the rename");
    report = await measureGodFiles(repo, defaultGodFileOptions);
  });

  after(() => fs.rmSync(scratch, { recursive: true, force: true }));

  it("G4: counts commits in the 90 days before HEAD's commit time (not the clock), under the file's current path across a rename", () => {
    const motor = itemOf(report, "src/core/motor.ts");
    assert.strictEqual(motor.commits, 5, "80, 25, the sweep, the rename and the last commit; not the one at 120 days");
  });

  it("G4: co-change areas come from the measured files of commits of at most 25 files; a larger commit is a sweep", () => {
    const motor = itemOf(report, "src/core/motor.ts");
    assert.deepStrictEqual(motor.coChangeAreas, ["apps/api", "packages/ui", "src/core"], "no area of the sweep's services, none for the README or the test");
  });

  it("G4: a blobless clone is measured without fetching; only exact renames count there", async () => {
    const blobless = path.join(scratch, "blobless");
    execFileSync("git", ["-c", "uploadpack.allowFilter=true", "clone", "--quiet", "--no-local", "--filter=blob:none", `file://${repo}`, blobless]);
    const before = fingerprint(blobless);
    const measured = await measureGodFiles(blobless, defaultGodFileOptions);
    assert.strictEqual(measured.commitCount, report.commitCount);
    assert.strictEqual(itemOf(measured, "src/core/motor.ts").commits, 2, "the rename that also changed the file is not followed");
    assert.strictEqual(fingerprint(blobless), before, "nothing was fetched into its .git");
  });

  it("reads files at a commit, and leaves out a path git cannot name instead of hanging", async () => {
    const texts = await readFilesAt(repo, "HEAD", ["src/core/helper.ts", "nope.py", "src/core/motor.ts"]);
    assert.deepStrictEqual(texts.map((text) => text.path), ["src/core/helper.ts", "src/core/motor.ts"]);
    assert.strictEqual(texts[0].text, "export const h = 1;\n");
  });

  it("G4: a shallow clone says so: its commit counts are a floor, not the history", async () => {
    const shallow = path.join(scratch, "shallow");
    execFileSync("git", ["clone", "--quiet", "--depth", "1", `file://${repo}`, shallow]);
    const cut = await measureGodFiles(shallow, defaultGodFileOptions);
    assert.strictEqual(cut.historyIsCut, true);
    assert.strictEqual(cut.commitCount, 1);
    assert.strictEqual(report.historyIsCut, false);
  });
});

describe("God files: areas and code lines", () => {
  it("names the area by the first folder, or the first two below a container folder", () => {
    assert.strictEqual(areaOf("apps/api/src/main.py"), "apps/api");
    assert.strictEqual(areaOf("packages/ui/button.tsx"), "packages/ui");
    assert.strictEqual(areaOf("src/shop/checkout.py"), "src/shop");
    assert.strictEqual(areaOf("src/main.ts"), "src");
    assert.strictEqual(areaOf("shop/checkout.py"), "shop");
    assert.strictEqual(areaOf("setup.py"), ".");
    for (const container of ["apps", "packages", "libs", "services", "src", "modules", "crates", "internal", "pkg", "cmd"]) {
      assert.strictEqual(areaOf(`${container}/a/b.go`), `${container}/a`, container);
    }
  });

  it("counts code lines without blank and comment-only lines", () => {
    assert.strictEqual(countCodeLines("a();\n\n// note\n/**\n * one\n */\nb(); // tail\nconst glob = \"**/*.ts\";\n", "typescript"), 3);
    assert.strictEqual(countCodeLines("import os\n\n# note\n    # indented note\nx = 1  # tail\n", "python"), 2);
    assert.strictEqual(countCodeLines("package main\n// c\nfunc main() {}\n", "other"), 2);
  });
});

function ts(filePath: string, text: string) {
  return { path: filePath, language: "typescript" as const, text };
}

function py(filePath: string, text: string) {
  return { path: filePath, language: "python" as const, text };
}

function known(names: string[]): Extract<Breadth, { state: "known" }> {
  return { state: "known", names: [...names].sort(), files: ["apps/web/page.ts"], complete: true };
}

interface Use {
  path: string | undefined;
  line: number;
}

interface FakeFile {
  path: string;
  lines: string[];
  symbols: SymbolNode[] | undefined;
}

function fakeFile(filePath: string, lines: string[], symbols: SymbolNode[] | undefined): FakeFile {
  return { path: filePath, lines, symbols };
}

// The character is filled in from the file's line, where the name stands.
function symbol(name: string, line: number, children: SymbolNode[] = []): SymbolNode {
  return { name, isClass: children.length > 0, line, character: -1, children };
}

// A language server that knows the given files; the references of a declaration by its "path:line".
function fakeServer(files: FakeFile[], references: Record<string, Use[]>): LanguageServer {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const placed = (file: FakeFile) => (node: SymbolNode): SymbolNode => ({ ...node, character: Math.max(0, file.lines[node.line]?.indexOf(node.name) ?? 0), children: node.children.map(placed(file)) });
  return {
    symbols: async (repoPath) => {
      const file = byPath.get(repoPath);
      return file?.symbols?.map(placed(file));
    },
    ready: async () => undefined,
    // A real server lists the declaration itself too.
    references: async (repoPath, line) => [{ path: repoPath, line }, ...(references[`${repoPath}:${line}`] ?? [])],
    text: async (repoPath) => byPath.get(repoPath)?.lines.join("\n") ?? "",
  };
}

function execGitShow(repo: string, object: string): string {
  return execFileSync("git", ["show", object], { cwd: repo, encoding: "utf8" });
}
