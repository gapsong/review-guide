import * as assert from "assert";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { measureBreadth } from "../../src/godfiles/breadth";
import { countCodeLines } from "../../src/godfiles/codeLines";
import { defaultGodFileOptions, GodFileItem, GodFileReport, measureGodFiles } from "../../src/godfiles/godFiles";
import { historyOf, parseLog } from "../../src/godfiles/history";
import { areaOf, godFileRules, hintOf } from "../../src/godfiles/rules";
import { globToRegExp, isMeasuredSource } from "../../src/godfiles/sourceFiles";
import { classMembersOf } from "../../src/godfiles/typescriptModules";
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
    assert.strictEqual(isMeasuredSource("src/a.ts", [globToRegExp("{docs,examples}/**")]), true);
    assert.strictEqual(isMeasuredSource("examples/a.ts", [globToRegExp("{docs,examples}/**")]), false);
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
    assert.deepStrictEqual(broad.namesUsedOutside, [...broadNames].sort());
    assert.deepStrictEqual(broad.coChangeAreas, ["apps/web", "packages/billing", "src/admin"]);
    assert.deepStrictEqual(ledger.namesUsedOutside, ["balance", "post"]);
    assert.ok(ledger.codeLines >= 600, `the ledger has ${ledger.codeLines} code lines`);
    assert.ok(broad.codeLines < ledger.codeLines, "the broad file is the shorter one");
    assert.deepStrictEqual(report.items.map((item) => item.path), ["src/shop/broad.ts", "src/ledger/ledger.ts", "src/long/table.ts"]);
    assert.strictEqual(broad.hint, "god file?");
    assert.strictEqual(ledger.hint, "deep");
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

  it("G2: the hint is 'god file?' above 7 names used outside; 'deep' needs 1 to 7 names, 300 code lines and at most 3 co-change areas; none when breadth is unknown or nothing imports the file", () => {
    assert.strictEqual(godFileRules.broadAboveNamesUsedOutside, 7);
    assert.strictEqual(godFileRules.deepAtMostCoChangeAreas, 3);
    assert.strictEqual(hintOf(8, 10, 0), "god file?");
    assert.strictEqual(hintOf(8, 10, 12), "god file?");
    assert.strictEqual(hintOf(7, 300, 3), "deep");
    assert.strictEqual(hintOf(7, 299, 3), undefined, "too short for a deep module");
    assert.strictEqual(hintOf(7, 300, 4), undefined, "narrow but changing with many areas: many reasons to change");
    assert.strictEqual(hintOf(0, 5000, 0), undefined, "nothing imports it: an entry point or unused, not a deep module");
    assert.strictEqual(hintOf(undefined, 5000, 0), undefined);
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
    assert.deepStrictEqual(ledger.namesUsedOutside, ["balance", "post"]);
    assert.deepStrictEqual(ledger.coChangeAreas, ["apps/web", "packages/billing", "src/admin", "src/ledger", "src/long", "src/shop"]);
    assert.strictEqual(ledger.hint, undefined);
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

describe("G3: breadth through imports", () => {
  it("G3: TypeScript and JavaScript: named, default, namespace, alias by path suffix, re-exports, require and dynamic import", () => {
    const breadth = measureBreadth([
      ts("src/lib/money.ts", "export function add() {}\nexport const cents = 1, euros = 2;\nexport class Purse {}\nexport interface Price {}\nexport type Rate = number;\nexport enum Coin { A }\nexport default function format() {}\nfunction hidden() {}\nexport { hidden as visible };\n"),
      ts("src/lib/index.ts", "export { add } from './money';\nexport * from './tax';\n"),
      ts("src/lib/tax.ts", "export const vat = 1;\nexport function rate() {}\n"),
      ts("src/lib/old.js", "exports.legacy = 1;\nmodule.exports.older = 2;\n"),
      ts("src/lib/cjs.js", "module.exports = { alpha, beta: 2, gamma() {} };\n"),
      ts("apps/web/a.ts", "import format, { cents as c, type Price } from '../../src/lib/money';\n// import { euros } from '../../src/lib/money';\n"),
      ts("apps/web/b.tsx", "import * as m from '@/lib/money';\nm.Purse; m.Coin; m.notExported;\n"),
      ts("apps/web/c.js", "const { legacy } = require('../../src/lib/old.js');\nconst cjs = require('../../src/lib/cjs');\ncjs.alpha(); require('../../src/lib/old').older;\n"),
      ts("apps/web/d.mjs", "const { rate } = await import('../../src/lib/tax.js');\n"),
      ts("apps/web/e.ts", "import { visible } from '~/lib/money';\nimport React from 'react';\nimport { x } from 'money';\n"),
      ts("apps/web/f.ts", "import { add, vat } from '../../src/lib';\n"),
    ]);
    assert.deepStrictEqual(breadth.get("src/lib/money.ts"), {
      namesUsedOutside: ["Price", "Purse", "Coin", "add", "cents", "default", "visible"].sort(),
      filesUsingIt: ["apps/web/a.ts", "apps/web/b.tsx", "apps/web/e.ts", "apps/web/f.ts", "src/lib/index.ts"],
    });
    assert.deepStrictEqual(breadth.get("src/lib/tax.ts"), { namesUsedOutside: ["rate", "vat"], filesUsingIt: ["apps/web/d.mjs", "apps/web/f.ts", "src/lib/index.ts"] }, "export * uses every name, and a name taken from the barrel is a use of its module");
    assert.deepStrictEqual(breadth.get("src/lib/index.ts"), { namesUsedOutside: ["add"], filesUsingIt: ["apps/web/f.ts"] });
    assert.deepStrictEqual(breadth.get("src/lib/old.js")?.namesUsedOutside, ["legacy", "older"]);
    assert.deepStrictEqual(breadth.get("src/lib/cjs.js")?.namesUsedOutside, ["alpha"]);
    assert.deepStrictEqual(breadth.get("apps/web/a.ts"), { namesUsedOutside: [], filesUsingIt: [] });
  });

  it("G3: a class with 12 public methods that other files call is broad, not deep: members count as names, members nobody calls and private ones do not", async () => {
    const methods = Array.from({ length: 12 }, (_, index) => `  method${index + 1}(): void {\n${filler(20, `step${index + 1}`)}\n  }\n`).join("");
    const model = `export class Model {\n  private secret = 1;\n  protected guarded(): void {}\n  #hidden(): void {}\n  _internal(): void {}\n  constructor(public readonly id: string) {}\n  static create(): Model { return new Model("1"); }\n  get title(): string { return ""; }\n  unused(): void {}\n${methods}}\nexport function helper(): void {}\n`;
    const sources = [
      ts("src/github/model.ts", model),
      ts("src/github/index.ts", "export { Model } from './model';\n"),
      ts("src/view/tree.ts", "import { Model } from '../github/model';\nconst m = Model.create();\nm.method1(); m.method2(); m.method3(); m.method4(); m.secret; m.guarded(); m._internal(); m.id;\n"),
      ts("src/commands.ts", "import * as github from './github/model';\nfunction run(m: github.Model) { m.method5(); m.method6(); m.method7(); m.method8(); m.title; }\n"),
      ts("src/webview.ts", "import type { Model } from './github';\nexport function show(m: Model) { m.method9(); m.method10(); m.method11(); m.method12(); }\n"),
      ts("src/other.ts", "const x = { method1() {}, unused() {} };\nx.method1(); x.unused();\n"),
    ];
    const breadth = measureBreadth(sources);
    assert.deepStrictEqual(breadth.get("src/github/model.ts"), {
      namesUsedOutside: ["Model", ...Array.from({ length: 12 }, (_, index) => `Model.method${index + 1}`), "Model.create", "Model.id", "Model.title"].sort(),
      filesUsingIt: ["src/commands.ts", "src/github/index.ts", "src/view/tree.ts", "src/webview.ts"],
    }, "a member counts when a file that imports the class accesses it (a public constructor parameter too); private, protected, #, _ and the constructor never; unused ones not; a file that does not import the class not");
    const scratch = makeTempDir("godfiles-g3-members");
    try {
      const repo = path.join(scratch, "repo");
      initRepo(repo);
      commitFilesAt(repo, 10, Object.fromEntries(sources.map((source) => [source.path, source.text])));
      const item = itemOf(await measureGodFiles(repo, defaultGodFileOptions), "src/github/model.ts");
      assert.strictEqual(item.hint, "god file?", "16 names used outside, the class and 15 of its members");
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("G3: Python: public methods, properties and class attributes other files access count as names; _names do not", () => {
    const breadth = measureBreadth([
      py("app/models.py", "class Order:\n    STATES = ['new']\n    _cache = {}\n\n    def __init__(self):\n        pass\n\n    @property\n    def total(self):\n        return 0\n\n    async def ship(self):\n        pass\n\n    def _recompute(self):\n        pass\n\n    def cancel(self):\n        pass\n\nclass Line:\n    def price(self):\n        pass\n"),
      py("app/views.py", "from app.models import Order\no = Order()\no.total; o.ship(); o._recompute(); Order.STATES; o._cache\n"),
      py("app/jobs.py", "import app.models as models\nmodels.Line().price()\n"),
      py("app/unrelated.py", "x.cancel()\n"),
    ]);
    assert.deepStrictEqual(breadth.get("app/models.py"), {
      namesUsedOutside: ["Line", "Line.price", "Order", "Order.STATES", "Order.ship", "Order.total"],
      filesUsingIt: ["app/jobs.py", "app/views.py"],
    });
  });

  it("G3: class members are found behind type arguments with braces, decorators, generics, getters and typed fields; private, protected and # never", () => {
    const members = classMembersOf("@injectable()\nexport default class Svc<T extends object> extends Base<{ a: 1 }> implements I {\n  @dec() public items: T[] = [];\n  handler = (x: number) => { return x; };\n  private readonly map = new Map<string, { b: 2 }>();\n  static readonly VERSION = \"1\";\n  get size(): number { return 0 }\n  set size(v: number) {}\n  async run<U>(a: U): Promise<void> {}\n  *gen() {}\n  opt?: string;\n  def!: string;\n  [key: string]: unknown;\n  protected prot() {}\n  #priv() {}\n  tpl = `a { b } ${\"c\"}`;\n  constructor(private a: number, public readonly b: string, protected c: number, readonly d: number, e: number) { super(); }\n}\nclass Later { later() {} }\nexport { Later };\n");
    assert.deepStrictEqual(members.get("Svc")?.sort(), ["VERSION", "b", "d", "def", "gen", "handler", "items", "opt", "run", "size", "tpl"]);
    assert.deepStrictEqual(members.get("default"), members.get("Svc"), "a default export is reached as default");
    assert.deepStrictEqual(members.get("Later"), ["later"]);
  });

  it("G3: an import that two files of the same suffix could mean is not counted for either, unless one shares more folders", () => {
    const breadth = measureBreadth([
      ts("packages/a/src/util/log.ts", "export function log() {}\n"),
      ts("packages/b/src/util/log.ts", "export function log() {}\n"),
      ts("packages/a/src/main.ts", "import { log } from 'src/util/log';\n"),
      ts("apps/x.ts", "import { log } from 'src/util/log';\n"),
    ]);
    assert.deepStrictEqual(breadth.get("packages/a/src/util/log.ts")?.filesUsingIt, ["packages/a/src/main.ts"]);
    assert.deepStrictEqual(breadth.get("packages/b/src/util/log.ts")?.filesUsingIt, []);
  });

  it("G3: Python: from-imports, import as with attributes, relative imports, __all__, private names and package re-exports", () => {
    const breadth = measureBreadth([
      py("src/shop/payment.py", "import os\n\nLIMIT = 3\n_secret = 1\n\ndef charge():\n    pass\n\nasync def refund():\n    pass\n\nclass Receipt:\n    def total(self):\n        pass\n\ndef _helper():\n    pass\n"),
      py("src/shop/__init__.py", "from .payment import Receipt\n"),
      py("src/shop/models.py", "__all__ = ['Order', \"Line\"]\nclass Order: pass\nclass Line: pass\nclass Hidden: pass\n"),
      py("src/api/views.py", "from shop.payment import charge, _secret\nimport shop.models as m\nm.Order\n\"\"\"from shop.payment import LIMIT\"\"\"\n# from shop.payment import refund\n"),
      py("src/api/admin.py", "from ..shop import payment\npayment.refund()\nfrom ..shop.models import (\n    Line,\n    Hidden,\n)\n"),
      py("src/api/home.py", "from shop import Receipt\nimport shop.payment\nshop.payment.LIMIT\n"),
      py("src/api/everything.py", "from src.shop.models import *\n"),
    ]);
    assert.deepStrictEqual(breadth.get("src/shop/payment.py"), {
      namesUsedOutside: ["LIMIT", "Receipt", "charge", "refund"],
      filesUsingIt: ["src/api/admin.py", "src/api/home.py", "src/api/views.py", "src/shop/__init__.py"],
    });
    assert.deepStrictEqual(breadth.get("src/shop/models.py"), { namesUsedOutside: ["Line", "Order"], filesUsingIt: ["src/api/admin.py", "src/api/everything.py", "src/api/views.py"] }, "__all__ decides; Hidden is not public");
    assert.deepStrictEqual(breadth.get("src/shop/__init__.py"), { namesUsedOutside: ["Receipt"], filesUsingIt: ["src/api/home.py"] }, "a package offers what its __init__ imports");
  });

  it("G3: Python: a name a package's __init__.py passes on is also a use of the module that defines it", () => {
    const breadth = measureBreadth([
      py("fastlib/applications.py", "class App:\n    pass\n"),
      py("fastlib/params.py", "def Query():\n    pass\n"),
      py("fastlib/__init__.py", "from .applications import App as App\nfrom .params import *\n"),
      py("docs/a.py", "from fastlib import App, Query\n"),
      py("docs/b.py", "import fastlib\nfastlib.App()\n"),
    ]);
    assert.deepStrictEqual(breadth.get("fastlib/applications.py"), { namesUsedOutside: ["App"], filesUsingIt: ["docs/a.py", "docs/b.py", "fastlib/__init__.py"] });
    assert.deepStrictEqual(breadth.get("fastlib/params.py"), { namesUsedOutside: ["Query"], filesUsingIt: ["docs/a.py", "fastlib/__init__.py"] });
  });

  it("G3: other languages show no breadth ('–', never 0) and still rank on history", async () => {
    const scratch = makeTempDir("godfiles-g3");
    try {
      const repo = path.join(scratch, "repo");
      initRepo(repo);
      commitFilesAt(repo, 30, { "cmd/server/main.go": `package main\n${filler(200)}\n`, "src/app.ts": `export function a() {}\n${filler(200)}\n` });
      commitFilesAt(repo, 20, { "cmd/server/main.go": `package main\n${filler(201)}\n` });
      const report = await measureGodFiles(repo, defaultGodFileOptions);
      const go = itemOf(report, "cmd/server/main.go");
      assert.strictEqual(go.namesUsedOutside, undefined);
      assert.strictEqual(go.filesUsingIt, undefined);
      assert.strictEqual(go.hint, undefined);
      assert.strictEqual(go.percentiles.namesUsedOutside, undefined, "unknown breadth is left out of the score");
      assert.strictEqual(go.commitsInWindow, 2);
      assert.strictEqual(report.items[0].path, "cmd/server/main.go", "it ranks on its history");
      assert.deepStrictEqual(itemOf(report, "src/app.ts").namesUsedOutside, []);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
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

  it("G4: counts commits in 30 and in 90 days before HEAD, under the file's current path across a rename", () => {
    const motor = itemOf(report, "src/core/motor.ts");
    assert.strictEqual(motor.commitsInWindow, 5, "80, 25, the sweep, the rename and the last commit; not the one at 120 days");
    assert.strictEqual(motor.commitsInRecentDays, 4);
    assert.strictEqual(report.days, 90);
  });

  it("G4: co-change partners and areas come from commits of at most 25 files; a larger commit is a sweep", () => {
    const motor = itemOf(report, "src/core/motor.ts");
    assert.deepStrictEqual(motor.coChangePartners, ["apps/api/routes.ts", "packages/ui/button.ts", "src/core/helper.ts"], "no file of the sweep, no README, no test");
    assert.deepStrictEqual(motor.coChangeAreas, ["apps/api", "packages/ui", "src/core"]);
    assert.strictEqual(godFileRules.largestCoChangeCommitFiles, 25);
  });

  it("G4: the window is measured from HEAD's commit time, so the same commit always gives the same numbers", async () => {
    const shorter = await measureGodFiles(repo, { ...defaultGodFileOptions, days: 7 });
    assert.strictEqual(itemOf(shorter, "src/core/motor.ts").commitsInWindow, 2);
    assert.strictEqual(shorter.commitCount, 2);
  });

  it("G4: a shallow clone says so: its commit counts are a floor, not the history", async () => {
    const shallow = path.join(scratch, "shallow");
    execFileSync("git", ["clone", "--quiet", "--depth", "1", `file://${repo}`, shallow]);
    const cut = await measureGodFiles(shallow, defaultGodFileOptions);
    assert.strictEqual(cut.historyIsCut, true);
    assert.strictEqual(cut.commitCount, 1);
    assert.strictEqual(report.historyIsCut, false);
  });

  it("G4: reads renames and sweeps from the log text", () => {
    const log = "\x1eaaa 300\0\nM\0src/b.ts\0A\0src/c.ts\0\x1ebbb 200\0\nR100\0src/a.ts\0src/b.ts\0\x1eccc 100\0\nM\0src/a.ts\0";
    const commits = parseLog(log);
    assert.deepStrictEqual(commits.map((commit) => commit.paths), [["src/b.ts", "src/c.ts"], ["src/b.ts"], ["src/b.ts"]]);
    const history = historyOf(commits, new Set(["src/b.ts", "src/c.ts"]), 250);
    assert.deepStrictEqual(history.files.get("src/b.ts"), { commitsInWindow: 3, commitsInRecentDays: 1, coChangePartners: ["src/c.ts"], coChangeAreas: ["src"] });
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
    assert.strictEqual(countCodeLines("a();\n\n// note\n/* one\n   two */\nb(); // tail\n/* x */ c();\nconst glob = \"**/*.ts\";\nd();\n", "typescript"), 5);
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

function execGitShow(repo: string, object: string): string {
  return execFileSync("git", ["show", object], { cwd: repo, encoding: "utf8" });
}
