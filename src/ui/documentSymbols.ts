import * as vscode from "vscode";
import { CodeSymbol, FileSymbols } from "../review/buildReviewUnits";
import { Checkout } from "../git/pullRequestCheckout";
import { fileSides } from "../git/pullRequestFiles";
import { FileDiff } from "../review/unifiedDiff";

const functionKinds = new Set([vscode.SymbolKind.Function, vscode.SymbolKind.Method, vscode.SymbolKind.Constructor]);
const classKinds = new Set([vscode.SymbolKind.Class, vscode.SymbolKind.Struct, vscode.SymbolKind.Interface]);
const containerKinds = new Set([vscode.SymbolKind.Namespace, vscode.SymbolKind.Module, vscode.SymbolKind.Package]);

// Reads functions and classes with the document symbols of the installed language extensions.
export async function readFileSymbols(checkout: Checkout, file: FileDiff): Promise<FileSymbols> {
  const sides = fileSides(checkout, file);
  return {
    old: file.status === "added" ? [] : await readSymbols(sides.basePath),
    new: file.status === "deleted" ? [] : await readSymbols(sides.headPath),
  };
}

export async function readSymbols(filePath: string): Promise<CodeSymbol[] | undefined> {
  const uri = vscode.Uri.file(filePath);
  const document = await vscode.workspace.openTextDocument(uri);
  const languageHasSymbols = await waitForSymbolProvider(uri, document.languageId);
  const symbols = await querySymbols(uri);
  if (symbols.length > 0) {
    return flatten(symbols, "");
  }
  return languageHasSymbols ? [] : undefined;
}

// A language extension registers its symbol provider only after it has started, so the first
// request for a language can come back empty. The first file of each language asks again for a
// short while; the other files of that language wait for the same answer.
function waitForSymbolProvider(uri: vscode.Uri, languageId: string): Promise<boolean> {
  let ready = symbolProviderReady.get(languageId);
  if (!ready) {
    ready = pollForSymbols(uri, languageServerStartupMilliseconds);
    symbolProviderReady.set(languageId, ready);
  }
  return ready;
}

const symbolProviderReady = new Map<string, Promise<boolean>>();

// Pylance can take this long to start on a busy machine. Languages without any provider (plain
// text, TOML) cost this wait once, in parallel with the others.
const languageServerStartupMilliseconds = 20_000;

async function pollForSymbols(uri: vscode.Uri, timeoutMilliseconds: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if ((await querySymbols(uri)).length > 0) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function querySymbols(uri: vscode.Uri): Promise<vscode.DocumentSymbol[]> {
  const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[] | undefined>(
    "vscode.executeDocumentSymbolProvider",
    uri,
  );
  return symbols ?? [];
}

// Functions nested in a function (callbacks, local helpers) belong to the outer function's unit,
// so the walk does not go into functions. It goes into classes, namespaces and modules.
function flatten(symbols: vscode.DocumentSymbol[], parentPath: string): CodeSymbol[] {
  const result: CodeSymbol[] = [];
  for (const symbol of symbols) {
    const symbolPath = parentPath ? `${parentPath}.${symbol.name}` : symbol.name;
    if (functionKinds.has(symbol.kind)) {
      result.push(codeSymbol(symbol, symbolPath, "function"));
    } else if (classKinds.has(symbol.kind)) {
      result.push(codeSymbol(symbol, symbolPath, "class"));
      result.push(...flatten(symbol.children ?? [], symbolPath));
    } else if (containerKinds.has(symbol.kind)) {
      result.push(...flatten(symbol.children ?? [], symbolPath));
    }
  }
  return result;
}

function codeSymbol(symbol: vscode.DocumentSymbol, path: string, kind: CodeSymbol["kind"]): CodeSymbol {
  return { path, kind, startLine: symbol.range.start.line + 1, endLine: symbol.range.end.line + 1 };
}
