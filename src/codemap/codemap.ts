import { isMap, isNode, isScalar, isSeq, LineCounter, parseDocument } from "yaml";
import { cleanRelativePath } from "./repoPath";

// The owner's codemap: one sentence and a label per important folder or file of a repo, in a personal,
// gitignored YAML file. This file reads and checks it. Pure, so it can be tested without VS Code.

export const codemapLabels = ["money", "security", "core", "feature", "util"] as const;
export type CodemapLabel = (typeof codemapLabels)[number];

export interface CodemapEntry {
  path: string;
  says: string;
  label: CodemapLabel;
  // A deep module (John Ousterhout): a small interface that hides much logic.
  deep: boolean;
  // Optional notes that only the Codemap view's tooltip and the Explain panel show;
  // the Explorer hover and the CodeLens stay at one sentence.
  // Why the path matters: what breaks, and for whom, when it is wrong.
  why?: string;
  // One sharp edge to watch when changing it.
  watch?: string;
  // Where to start reading: a repo path, optionally with a line ("src/x.py:120").
  start?: string;
  // The owner's own explanation, in their own words; may span several lines.
  mine?: string;
}

export interface CodemapProblem {
  // Counts from 1, like the line numbers in the editor.
  line: number;
  message: string;
}

export interface Codemap {
  entries: CodemapEntry[];
  problems: CodemapProblem[];
}

// One sentence fits a hover; more would need a paragraph, and that belongs in the explanation.
export const maximumSaysLength = 160;

// The notes are short on purpose: a tooltip is read in passing. "why" and "watch" get two
// sentences, "start" a path and a line, and "mine" a paragraph or two in the owner's words.
export const maximumNoteLengths = {
  why: 300,
  watch: 200,
  start: 200,
  mine: 1500,
} as const;

type NoteKey = keyof typeof maximumNoteLengths;

const noteKeys: NoteKey[] = ["why", "watch", "start", "mine"];

// Only "mine" may span lines: the other notes are shown as one line each.
const multiLineNotes: NoteKey[] = ["mine"];

const allowedKeys = ["path", "says", "label", "deep", ...noteKeys];

interface Field {
  value: unknown;
  line: number;
}

interface ReadEntry {
  entry: CodemapEntry | undefined;
  line: number;
  // The line of the "start" key, when the entry has one.
  startLine: number | undefined;
  problems: CodemapProblem[];
}

// Where "start" points: a repo path, and a line in it when one was given.
export interface StartLocation {
  path: string;
  // Counts from 1, like the line numbers in the editor.
  line: number | undefined;
}

// An entry with a problem is left out, so the Explorer never shows a half-right badge.
// A path that does not exist is only reported: the entry is still the owner's knowledge, and they decide
// whether the code moved or is gone.
export function parseCodemap(text: string, pathExists: (repoPath: string) => boolean): Codemap {
  const lineCounter = new LineCounter();
  const document = parseDocument(text, { lineCounter });
  const lineAt = (offset: number) => lineCounter.linePos(offset).line;

  // A broken YAML file is not guessed at: the owner fixes the reported line first.
  if (document.errors.length > 0) {
    return {
      entries: [],
      problems: document.errors.map((error) => ({ line: error.linePos?.[0].line ?? 1, message: yamlErrorMessage(error.message) })),
    };
  }
  const list = document.contents;
  if (list === null) {
    return { entries: [], problems: [] };
  }
  if (!isSeq(list)) {
    return { entries: [], problems: [{ line: lineAt(list.range[0]), message: "the codemap must be a list of entries, each starting with \"- path:\"" }] };
  }

  const entries: CodemapEntry[] = [];
  const problems: CodemapProblem[] = [];
  const firstLineOfPath = new Map<string, number>();
  for (const item of list.items) {
    const { entry, line, startLine, problems: entryProblems } = readEntry(item, lineAt);
    problems.push(...entryProblems);
    if (!entry) {
      continue;
    }
    const firstLine = firstLineOfPath.get(entry.path);
    if (firstLine !== undefined) {
      problems.push({ line, message: `path is listed twice (first on line ${firstLine})` });
      continue;
    }
    firstLineOfPath.set(entry.path, line);
    if (!pathExists(entry.path)) {
      problems.push({ line, message: "path does not exist (moved or deleted?)" });
    }
    const start = entry.start === undefined ? undefined : startLocationOf(entry.start);
    if (start && !pathExists(start.path)) {
      problems.push({ line: startLine ?? line, message: "start points to a path that does not exist (moved or deleted?)" });
    }
    entries.push(entry);
  }
  return { entries, problems };
}

// Every problem of an entry is reported, not only the first, so one save shows all that is left to fix.
function readEntry(item: unknown, lineAt: (offset: number) => number): ReadEntry {
  const itemLine = isNode(item) && item.range ? lineAt(item.range[0]) : 1;
  if (!isMap(item)) {
    return { entry: undefined, line: itemLine, startLine: undefined, problems: [{ line: itemLine, message: "an entry needs path, says and label (deep, why, watch, start and mine are optional)" }] };
  }
  const problems: CodemapProblem[] = [];
  const fields = new Map<string, Field>();
  for (const pair of item.items) {
    const key = isScalar(pair.key) ? String(pair.key.value) : "";
    const keyLine = isScalar(pair.key) && pair.key.range ? lineAt(pair.key.range[0]) : itemLine;
    if (!allowedKeys.includes(key)) {
      problems.push({ line: keyLine, message: `unknown key "${key}" (allowed: ${allowedKeys.join(", ")})` });
      continue;
    }
    fields.set(key, { value: isScalar(pair.value) ? pair.value.value : pair.value, line: keyLine });
  }

  const path = readPath(fields.get("path"), itemLine, problems);
  const says = readSays(fields.get("says"), itemLine, problems);
  const label = readLabel(fields.get("label"), itemLine, problems);
  const deep = readDeep(fields.get("deep"), problems);
  const notes = readNotes(fields, problems);
  const line = fields.get("path")?.line ?? itemLine;
  const startLine = fields.get("start")?.line;
  if (problems.length > 0 || path === undefined || says === undefined || label === undefined || deep === undefined) {
    return { entry: undefined, line, startLine, problems };
  }
  return { entry: { path, says, label, deep, ...notes }, line, startLine, problems };
}

// "src/app.py:120" -> { path: "src/app.py", line: 120 }; "src/app.py" -> no line.
// Undefined when it is not a repo path that stays inside the workspace folder.
export function startLocationOf(start: string): StartLocation | undefined {
  const match = /^(.*?)(?::(\d+))?$/.exec(start.trim())!;
  const path = cleanRelativePath(match[1]);
  const line = match[2] === undefined ? undefined : Number(match[2]);
  if (path === undefined || line === 0) {
    return undefined;
  }
  return { path, line };
}

function readPath(field: Field | undefined, entryLine: number, problems: CodemapProblem[]): string | undefined {
  if (!field || field.value === null) {
    problems.push({ line: entryLine, message: "path is missing" });
    return undefined;
  }
  if (typeof field.value !== "string") {
    problems.push({ line: field.line, message: "path must be text" });
    return undefined;
  }
  const path = cleanRelativePath(field.value);
  if (path === undefined) {
    problems.push({ line: field.line, message: "path must be relative to the workspace folder, without \"..\" and without a leading \"/\"" });
  }
  return path;
}

function readSays(field: Field | undefined, entryLine: number, problems: CodemapProblem[]): string | undefined {
  if (!field) {
    problems.push({ line: entryLine, message: "says is missing" });
    return undefined;
  }
  if (field.value !== null && typeof field.value !== "string") {
    problems.push({ line: field.line, message: "says must be text" });
    return undefined;
  }
  const says = (field.value ?? "").trim();
  // Counted in characters as a person sees them, so umlauts and emoji count once.
  const length = Array.from(says).length;
  if (length === 0) {
    problems.push({ line: field.line, message: "says is empty" });
    return undefined;
  }
  if (length > maximumSaysLength) {
    problems.push({ line: field.line, message: `says is ${length} characters long (at most ${maximumSaysLength})` });
    return undefined;
  }
  return says;
}

function readLabel(field: Field | undefined, entryLine: number, problems: CodemapProblem[]): CodemapLabel | undefined {
  if (!field) {
    problems.push({ line: entryLine, message: "label is missing" });
    return undefined;
  }
  const label = codemapLabels.find((known) => known === field.value);
  if (!label) {
    problems.push({ line: field.line, message: `label "${String(field.value ?? "")}" is not one of ${codemapLabels.join(", ")}` });
  }
  return label;
}

// Only the notes that are written down are set, so an entry without notes compares equal to one
// read before notes existed.
function readNotes(fields: Map<string, Field>, problems: CodemapProblem[]): Partial<Record<NoteKey, string>> {
  const notes: Partial<Record<NoteKey, string>> = {};
  for (const key of noteKeys) {
    const field = fields.get(key);
    if (field) {
      notes[key] = readNote(key, field, problems);
    }
  }
  return notes;
}

function readNote(key: NoteKey, field: Field, problems: CodemapProblem[]): string | undefined {
  if (field.value !== null && typeof field.value !== "string") {
    problems.push({ line: field.line, message: `${key} must be text` });
    return undefined;
  }
  const note = (field.value ?? "").trim();
  const length = Array.from(note).length;
  if (length === 0) {
    problems.push({ line: field.line, message: `${key} is empty (leave it out instead)` });
    return undefined;
  }
  if (note.includes("\n") && !multiLineNotes.includes(key)) {
    problems.push({ line: field.line, message: `${key} must be one line (only mine may span several)` });
    return undefined;
  }
  if (length > maximumNoteLengths[key]) {
    problems.push({ line: field.line, message: `${key} is ${length} characters long (at most ${maximumNoteLengths[key]})` });
    return undefined;
  }
  if (key === "start" && startLocationOf(note) === undefined) {
    problems.push({ line: field.line, message: "start must be a path in the workspace folder, optionally with a line, like \"src/app.py:120\"" });
    return undefined;
  }
  return note;
}

// YAML reads `deep: yes` as the text "yes", not as true; saying so beats silently ignoring it.
function readDeep(field: Field | undefined, problems: CodemapProblem[]): boolean | undefined {
  if (!field) {
    return false;
  }
  if (typeof field.value !== "boolean") {
    problems.push({ line: field.line, message: `deep must be true or false, not "${String(field.value ?? "")}"` });
    return undefined;
  }
  return field.value;
}

// The YAML library's message names the line and adds a code excerpt; the Problems view shows the line already.
function yamlErrorMessage(message: string): string {
  const firstLine = message.split("\n")[0].replace(/ at line \d+, column \d+:?$/, "");
  return `YAML: ${firstLine}`;
}
