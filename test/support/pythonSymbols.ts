import * as fs from "fs";
import { Checkout } from "../../src/git/pullRequestCheckout";
import { fileSides } from "../../src/git/pullRequestFiles";
import { CodeSymbol, FileSymbols } from "../../src/review/buildReviewUnits";
import { FileDiff } from "../../src/review/unifiedDiff";

// Outside VS Code there are no document symbols, so unit tests read Python `def` and `class`
// lines themselves, following the same rules as the VS Code adapter (no functions inside functions).
export async function readPythonSymbols(checkout: Checkout, file: FileDiff): Promise<FileSymbols> {
  const sides = fileSides(checkout, file);
  return { old: symbolsOf(sides.basePath), new: symbolsOf(sides.headPath) };
}

function symbolsOf(filePath: string): CodeSymbol[] {
  const lines = fs.readFileSync(filePath, "utf8").split("\n");
  const symbols: CodeSymbol[] = [];
  const open: { indent: number; symbol: CodeSymbol }[] = [];
  lines.forEach((text, index) => {
    const indent = text.length - text.trimStart().length;
    if (text.trim() !== "") {
      while (open.length > 0 && indent <= open[open.length - 1].indent) {
        open.pop();
      }
    }
    const match = /^(\s*)(def|class)\s+(\w+)/.exec(text);
    const insideFunction = open.some((entry) => entry.symbol.kind === "function");
    if (match && !insideFunction) {
      const parent = open.length > 0 ? `${open[open.length - 1].symbol.path}.` : "";
      const symbol: CodeSymbol = { path: parent + match[3], kind: match[2] === "def" ? "function" : "class", startLine: index + 1, endLine: index + 1 };
      symbols.push(symbol);
      open.push({ indent, symbol });
    }
    if (text.trim() !== "") {
      for (const entry of open) {
        entry.symbol.endLine = index + 1;
      }
    }
  });
  return symbols;
}
