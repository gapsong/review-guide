import { parseFileMethods } from "@barney-media/cognitive-typescript-core";
import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { languageOf } from "./sourceFiles";

// Cognitive complexity (https://www.sonarsource.com/docs/CognitiveComplexity.pdf): where reading a
// file is hard. Shown for the hardest function of each file the God Files view shows; never part
// of the score or the hint, which follow breadth and reasons to change.
//
//   HEAD texts ──► a temporary folder ──┬─ TypeScript/JavaScript: @barney-media/cognitive-typescript-core, in process
//                                       └─ Python: the complexipy CLI (setting reviewGuide.complexipyPath), no shell
//
// The tools read copies of HEAD in a temporary folder, never the working tree, and the folder is
// removed afterwards.

export interface HardestFunction {
  // "Class.method" or "function".
  name: string;
  // 1-based, in the file at HEAD.
  line: number;
  score: number;
}

export type Complexity =
  | { state: "pending" }
  // missingTool: complexipy is not installed, so the view can say once how to install it.
  | { state: "unknown"; reason: string; missingTool?: boolean }
  // hardest is undefined for a file without functions.
  | { state: "known"; hardest: HardestFunction | undefined };

export interface HeadText {
  path: string;
  text: string;
}

export async function measureComplexity(files: HeadText[], complexipyPath: string): Promise<Map<string, Complexity>> {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "review-guide-complexity-"));
  try {
    const typescript = files.filter((file) => languageOf(file.path) === "typescript");
    const python = files.filter((file) => languageOf(file.path) === "python");
    const others = files.filter((file) => !typescript.includes(file) && !python.includes(file));
    const [typescriptResults, pythonResults] = await Promise.all([
      typescriptComplexity(folder, typescript),
      pythonComplexity(folder, python, complexipyPath),
    ]);
    const unmeasured: Complexity = { state: "unknown", reason: "Cognitive complexity is measured for TypeScript, JavaScript and Python files only." };
    return new Map([...typescriptResults, ...pythonResults, ...others.map((file) => [file.path, unmeasured] as const)]);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

// One file at a time, so a file the parser refuses leaves the others measured. JavaScript is parsed
// as TypeScript (the package reads .ts files only); TypeScript's syntax is a superset of it.
async function typescriptComplexity(folder: string, files: HeadText[]): Promise<[string, Complexity][]> {
  const results: [string, Complexity][] = [];
  for (const [index, file] of files.entries()) {
    const copy = path.join(folder, "ts", String(index), path.posix.basename(file.path).replace(/\.(m|c)?js(x?)$/, ".$1ts$2"));
    fs.mkdirSync(path.dirname(copy), { recursive: true });
    fs.writeFileSync(copy, file.text);
    try {
      const methods = await parseFileMethods(copy);
      results.push([file.path, hardestOf(methods.map((method) => ({ name: method.displayName, line: method.startLine, score: method.cognitiveComplexity })))]);
    } catch (error) {
      results.push([file.path, { state: "unknown", reason: `The TypeScript parser refused the file: ${firstLine(error)}` }]);
    }
  }
  return results;
}

interface ComplexipyResult {
  complexity: number;
  function_name: string;
  path: string;
}

async function pythonComplexity(folder: string, files: HeadText[], complexipyPath: string): Promise<[string, Complexity][]> {
  if (files.length === 0) {
    return [];
  }
  const copies = new Map(files.map((file, index) => [`py/${index}/${path.posix.basename(file.path)}`, file]));
  for (const [copy, file] of copies) {
    fs.mkdirSync(path.dirname(path.join(folder, copy)), { recursive: true });
    fs.writeFileSync(path.join(folder, copy), file.text);
  }
  const output = "complexipy.json";
  const failed = await new Promise<{ reason: string; missingTool?: boolean } | undefined>((resolve) => {
    // complexipy fails a run when a function is above its allowed complexity (-i does not stop
    // that), so the limit is set out of reach: here it only reports.
    execFile(complexipyPath, [...copies.keys(), "--output-format", "json", "--output", output, "-q", "--max-complexity-allowed", "1000000"], { cwd: folder, shell: false, timeout: 120_000 }, (error, _stdout, stderr) => {
      if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
        resolve({ reason: `complexipy was not found ("${complexipyPath}"). Install it, e.g. \`uv tool install complexipy\`, or set reviewGuide.complexipyPath.`, missingTool: true });
      } else {
        resolve(error ? { reason: `complexipy failed: ${firstLine(stderr || error.message)}` } : undefined);
      }
    });
  });
  if (failed) {
    return files.map((file) => [file.path, { state: "unknown", ...failed }]);
  }
  const answer = JSON.parse(fs.readFileSync(path.join(folder, output), "utf8")) as ComplexipyResult[];
  return [...copies].map(([copy, file]) => {
    const functions = answer.filter((result) => result.path === copy).map((result) => {
      const parts = result.function_name.split("::");
      return { name: parts.join("."), line: pythonLineOf(file.text, parts), score: result.complexity };
    });
    return [file.path, hardestOf(functions)];
  });
}

// The highest score; on a tie the first in the file.
function hardestOf(functions: HardestFunction[]): Complexity {
  const sorted = [...functions].sort((first, second) => second.score - first.score || first.line - second.line);
  return { state: "known", hardest: sorted[0] };
}

// complexipy names a function "Class::method" without its line: each part is the next "def" or
// "class" of that name after the one before.
export function pythonLineOf(text: string, parts: string[]): number {
  const lines = text.split(/\r?\n/);
  let line = 0;
  for (const part of parts) {
    const definition = new RegExp(`^\\s*(?:async\\s+)?(?:def|class)\\s+${part.replace(/[^\w]/g, "")}\\b`);
    const found = lines.findIndex((text, index) => index >= line && definition.test(text));
    if (found === -1) {
      break;
    }
    line = found;
  }
  return line + 1;
}

function firstLine(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).trim().split("\n")[0].slice(0, 200);
}
