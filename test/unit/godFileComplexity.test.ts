import * as assert from "assert";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { measureComplexity, pythonLineOf } from "../../src/godfiles/complexity";
import { makeTempDir } from "../support/gitFixture";

const typescriptText = [
  "export function flat(a: number): number {",
  "  return a + 1;",
  "}",
  "export class Checkout {",
  "  total(items: number[]): number {",
  "    let sum = 0;",
  "    for (const item of items) {",
  "      if (item > 0) {",
  "        if (item > 10 && item < 100 || item === 5) {",
  "          sum += item;",
  "        }",
  "      }",
  "    }",
  "    return sum;",
  "  }",
  "}",
].join("\n");

const pythonText = [
  "def flat(a):",
  "    return a",
  "",
  "class Checkout:",
  "    def total(self, items):",
  "        for item in items:",
  "            if item:",
  "                pass",
].join("\n");

// complexipy fails a run with a function above its default limit of 15 unless the limit is raised.
const hardPythonText = `def hard(a):\n${Array.from({ length: 20 }, (_, index) => `    if a == ${index}:\n        return ${index}`).join("\n")}\n    return 0\n`;

describe("God files: cognitive complexity of the hardest function (display only)", () => {
  let scratch: string;

  before(() => {
    scratch = makeTempDir("godfiles-complexity");
  });

  after(() => fs.rmSync(scratch, { recursive: true, force: true }));

  it("TypeScript and JavaScript: the hardest function, its line and its score, from the package in process", async () => {
    const results = await measureComplexity([
      { path: "src/shop/checkout.ts", text: typescriptText },
      { path: "src/shop/legacy.js", text: typescriptText.replace(/: number(\[\])?/g, "") },
      { path: "src/shop/empty.ts", text: "export const a = 1;\n" },
      { path: "src/shop/broken.ts", text: "export function (\n" },
      { path: "cmd/main.go", text: "package main\n" },
    ], "complexipy");
    assert.deepStrictEqual(results.get("src/shop/checkout.ts"), { state: "known", hardest: { name: "Checkout.total", line: 5, score: 8 } });
    assert.deepStrictEqual(results.get("src/shop/legacy.js"), { state: "known", hardest: { name: "Checkout.total", line: 5, score: 8 } }, "JavaScript is parsed as TypeScript");
    assert.deepStrictEqual(results.get("src/shop/empty.ts"), { state: "known", hardest: undefined });
    const broken = results.get("src/shop/broken.ts");
    assert.ok(broken?.state === "unknown" && broken.reason.startsWith("The TypeScript parser refused the file"), JSON.stringify(broken));
    assert.deepStrictEqual(results.get("cmd/main.go"), { state: "unknown", reason: "Cognitive complexity is measured for TypeScript, JavaScript and Python files only." });
  });

  it("Python: complexipy runs without a shell on copies in a temporary folder, never on the repo, and the line is found from its name", async () => {
    // A stand-in complexipy that records its arguments and answers like the real one.
    const log = path.join(scratch, "calls.json");
    const fake = path.join(scratch, "fake-complexipy.js");
    fs.writeFileSync(fake, `#!/usr/bin/env node
const fs = require("fs");
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ args, cwd: process.cwd(), files: args.filter((a) => a.endsWith(".py")).map((f) => fs.readFileSync(f, "utf8")) }));
const out = args[args.indexOf("--output") + 1];
const file = args.find((a) => a.endsWith(".py"));
fs.writeFileSync(out, JSON.stringify([{ complexity: 1, function_name: "flat", path: file }, { complexity: 3, function_name: "Checkout::total", path: file }]));
`, { mode: 0o755 });
    const results = await measureComplexity([{ path: "app/shop/checkout.py", text: pythonText }], fake);
    assert.deepStrictEqual(results.get("app/shop/checkout.py"), { state: "known", hardest: { name: "Checkout.total", line: 5, score: 3 } });
    const call = JSON.parse(fs.readFileSync(log, "utf8")) as { args: string[]; cwd: string; files: string[] };
    assert.deepStrictEqual(call.args.slice(1), ["--output-format", "json", "--output", "complexipy.json", "-q", "--max-complexity-allowed", "1000000"]);
    assert.ok(call.cwd.includes("review-guide-complexity-") && !fs.existsSync(call.cwd), "a temporary folder, removed afterwards");
    assert.deepStrictEqual(call.files, [pythonText], "a copy of the text it was given (HEAD's), not a file of the working tree");
  });

  it("Python: a missing complexipy shows \"–\" with how to install it, never a 0", async () => {
    const results = await measureComplexity([{ path: "app/a.py", text: pythonText }], path.join(scratch, "no-such-complexipy"));
    const missing = results.get("app/a.py");
    assert.ok(missing?.state === "unknown" && missing.missingTool === true && missing.reason.includes("uv tool install complexipy"), JSON.stringify(missing));
  });

  it("Python: the real complexipy, when installed", async function () {
    try {
      execFileSync("complexipy", ["--version"]);
    } catch {
      this.skip();
    }
    const results = await measureComplexity([{ path: "app/shop/checkout.py", text: pythonText }, { path: "app/hard.py", text: hardPythonText }], "complexipy");
    assert.deepStrictEqual(results.get("app/shop/checkout.py"), { state: "known", hardest: { name: "Checkout.total", line: 5, score: 3 } });
    assert.deepStrictEqual(results.get("app/hard.py"), { state: "known", hardest: { name: "hard", line: 1, score: 20 } }, "a function above complexipy's own limit is reported, not a failure");
  });

  it("finds a Python function's line from complexipy's \"Class::method\" name", () => {
    const text = "def total():\n    pass\nclass A:\n    def total(self):\n        pass\nclass B:\n    async def total(self):\n        pass\n";
    assert.strictEqual(pythonLineOf(text, ["total"]), 1);
    assert.strictEqual(pythonLineOf(text, ["A", "total"]), 4);
    assert.strictEqual(pythonLineOf(text, ["B", "total"]), 7);
    assert.strictEqual(pythonLineOf(text, ["Missing"]), 1, "an unknown name opens the top of the file");
  });
});
