import { DiffLine } from "./unifiedDiff";

export interface LineRange {
  start: number;
  end: number;
}

export type UnitKind = "function" | "class" | "module" | "hunk";

// A changed function (or method, or class body): the unit that is reviewed, tiered and marked read.
export interface ReviewUnit {
  // Stable across pushes: the file plus the function's name path (or "module", or the hunk position).
  id: string;
  file: string;
  kind: UnitKind;
  // "QuantLinear.merge" for functions and classes; empty for module and hunk units.
  symbolPath: string;
  // Lines of the unit in the new file; for a removed function, the place where it used to be.
  newRange: LineRange;
  // Changed lines with a little surrounding context, in diff order.
  lines: DiffLine[];
  // Changes whenever the unit's changed lines change; drives the cache and "changed since your review".
  hash: string;
  isTestFile: boolean;
  // False for a function or file that the PR adds: it cannot weaken anything that was there before.
  existedBefore: boolean;
}

export function unitTitle(unit: ReviewUnit): string {
  switch (unit.kind) {
    case "function":
      return `${unit.symbolPath}()`;
    case "class":
      return `class ${unit.symbolPath}`;
    case "module":
      return "(outside functions)";
    case "hunk":
      return `lines ${unit.newRange.start}-${unit.newRange.end}`;
  }
}

export function unitDiffText(unit: ReviewUnit): string {
  return unit.lines.map(formatDiffLine).join("\n");
}

function formatDiffLine(line: DiffLine): string {
  const marker = line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " ";
  const lineNumber = line.newLine ?? line.oldLine ?? "";
  return `${marker}${String(lineNumber).padStart(5)} | ${line.text}`;
}
