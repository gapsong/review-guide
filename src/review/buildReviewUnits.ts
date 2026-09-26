import { createHash } from "crypto";
import { LineRange, ReviewUnit, UnitKind } from "./reviewUnit";
import { isTestFile } from "./testFiles";
import { DiffLine, FileDiff, Hunk } from "./unifiedDiff";

// A function, method or class found by VS Code's document symbols. Lines are 1-based and inclusive.
export interface CodeSymbol {
  path: string;
  kind: "function" | "class";
  startLine: number;
  endLine: number;
}

// Symbols of the old and the new version of a file. `undefined` means no symbol provider could
// read that version; its changed lines then fall back to raw git hunks.
export interface FileSymbols {
  old: CodeSymbol[] | undefined;
  new: CodeSymbol[] | undefined;
}

const contextLines = 3;

// Turns one file's diff into review units: hunks in the same function are merged, a hunk that
// touches several functions is split, and changes outside any function form one unit per file.
export function buildReviewUnits(file: FileDiff, symbols: FileSymbols): ReviewUnit[] {
  const drafts = new Map<string, UnitDraft>();
  for (const hunk of file.hunks) {
    for (const [index, line] of hunk.lines.entries()) {
      if (line.kind === "context") {
        continue;
      }
      const owner = findOwner(line, hunk, symbols);
      if (owner.kind === "module" && line.text.trim() === "") {
        // A blank line between functions is not worth a unit of its own.
        continue;
      }
      const draft = drafts.get(owner.key) ?? newDraft(owner);
      draft.changedLines.push({ hunk, index });
      drafts.set(owner.key, draft);
    }
  }
  return [...drafts.values()].map((draft) => finishUnit(file, draft, symbols));
}

interface Owner {
  key: string;
  kind: UnitKind;
  symbolPath: string;
}

interface UnitDraft extends Owner {
  changedLines: { hunk: Hunk; index: number }[];
}

function newDraft(owner: Owner): UnitDraft {
  return { ...owner, changedLines: [] };
}

function findOwner(line: DiffLine, hunk: Hunk, symbols: FileSymbols): Owner {
  const isAdded = line.kind === "added";
  const sideSymbols = isAdded ? symbols.new : symbols.old;
  if (!sideSymbols) {
    return { key: `hunk:${hunkFingerprint(hunk)}`, kind: "hunk", symbolPath: "" };
  }
  const lineNumber = isAdded ? line.newLine! : line.oldLine!;
  const symbol = innermostSymbolAt(sideSymbols, lineNumber);
  if (!symbol) {
    return { key: "module", kind: "module", symbolPath: "" };
  }
  return { key: `${symbol.kind}:${symbol.path}`, kind: symbol.kind, symbolPath: symbol.path };
}

// A hunk unit is known by its changed text, not its position, so a push that shifts it keeps its id.
function hunkFingerprint(hunk: Hunk): string {
  const hash = createHash("sha256");
  for (const line of hunk.lines.filter((candidate) => candidate.kind !== "context")) {
    hash.update(`${line.kind}:${line.text}\n`);
  }
  return hash.digest("hex").slice(0, 12);
}

function innermostSymbolAt(symbols: CodeSymbol[], lineNumber: number): CodeSymbol | undefined {
  const containing = symbols.filter((symbol) => symbol.startLine <= lineNumber && lineNumber <= symbol.endLine);
  containing.sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine));
  return containing[0];
}

function finishUnit(file: FileDiff, draft: UnitDraft, symbols: FileSymbols): ReviewUnit {
  const path = file.status === "deleted" ? file.oldPath : file.newPath;
  const lines = linesWithContext(draft);
  return {
    id: `${path}#${draft.key}`,
    file: path,
    kind: draft.kind,
    symbolPath: draft.symbolPath,
    newRange: newRangeOf(lines),
    lines,
    hash: hashOf(path, draft),
    isTestFile: isTestFile(path),
    existedBefore: existedBefore(file, draft, symbols),
  };
}

// Unknown old symbols count as "existed": the weakened-test rule then errs on the side of critical.
function existedBefore(file: FileDiff, draft: UnitDraft, symbols: FileSymbols): boolean {
  if (file.status === "added") {
    return false;
  }
  if (draft.kind !== "function" && draft.kind !== "class") {
    return true;
  }
  return symbols.old?.some((symbol) => symbol.path === draft.symbolPath) ?? true;
}

// The unit's own changed lines plus a few unchanged lines around them. Changed lines that belong
// to other units are left out, so each unit shows only its own change.
function linesWithContext(draft: UnitDraft): DiffLine[] {
  const ownIndexesByHunk = new Map<Hunk, Set<number>>();
  for (const { hunk, index } of draft.changedLines) {
    ownIndexesByHunk.set(hunk, (ownIndexesByHunk.get(hunk) ?? new Set()).add(index));
  }
  const lines: DiffLine[] = [];
  for (const [hunk, ownIndexes] of ownIndexesByHunk) {
    const first = Math.max(0, Math.min(...ownIndexes) - contextLines);
    const last = Math.min(hunk.lines.length - 1, Math.max(...ownIndexes) + contextLines);
    for (let index = first; index <= last; index++) {
      const line = hunk.lines[index];
      if (line.kind === "context" || ownIndexes.has(index)) {
        lines.push(line);
      }
    }
  }
  return lines;
}

// A removed file anchors its lines at 0 ("+0,0"); line 1 of the empty file stands in for it.
function newRangeOf(lines: DiffLine[]): LineRange {
  const changed = lines.filter((line) => line.kind !== "context");
  const positions = changed.map((line) => Math.max(1, line.newLine ?? line.newAnchor!));
  return {
    start: positions.reduce((smallest, position) => Math.min(smallest, position)),
    end: positions.reduce((largest, position) => Math.max(largest, position)),
  };
}

// Built from the changed text only, not from line numbers, so moving an unchanged function keeps its hash.
function hashOf(path: string, draft: UnitDraft): string {
  const hash = createHash("sha256").update(`${path}\n${draft.key}\n`);
  for (const { hunk, index } of draft.changedLines) {
    const line = hunk.lines[index];
    hash.update(`${line.kind === "added" ? "+" : "-"}${line.text}\n`);
  }
  return hash.digest("hex").slice(0, 16);
}
