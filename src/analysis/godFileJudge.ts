import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { RunClaude } from "../claude/claudeCli";
import { godFileJudgePrompt, numbersText } from "../claude/godFileJudgePrompt";
import { godFileJudgeSchema } from "../claude/schemas";
import { cleanRelativePath } from "../codemap/repoPath";
import { folderKey, HeadCopies } from "../git/headCopy";
import { GodFileItem, GodFileReport } from "../godfiles/godFiles";
import { readGit } from "../godfiles/readOnlyGit";

// "Judge with Claude" for one file of the God Files view, without VS Code: one read-only Claude call
// in a copy of the repo's HEAD (the same copies "Check my words" reads), started only by the owner.
// The judgment is checked against its schema and kept per file and HEAD commit in the extension's
// storage; nothing is written into the repo.
//
//   storage/head-copies/<folder>/<commit>/            Claude's working directory (tracked files only)
//   storage/god-file-context/<folder>/<path hash>/   history.txt, numbers.txt (Claude may read)
//   storage/god-file-judgments/<folder>/<path hash>/<commit>.json

export type GodFileVerdict = "god_file" | "deep_module" | "hub" | "ok";

export const godFileVerdicts: GodFileVerdict[] = ["god_file", "deep_module", "hub", "ok"];

export interface NamedReason {
  name: string;
  why: string;
}

export interface GodFileJudgment {
  verdict: GodFileVerdict;
  verdictWhy: string;
  // Lines outside the file are dropped (undefined), so they never become links.
  responsibilities: { name: string; startLine: number | undefined; endLine: number | undefined; mainFunctions: string[] }[];
  reasonsToChange: { theme: string; commits: number }[];
  namesUsedOutside: { justified: NamedReason[]; notJustified: NamedReason[] };
  readingPath: { name: string; line: number | undefined; why: string }[];
  keepOrSplit: { decision: "keep whole" | "split"; why: string; modules: { name: string; moves: string; interface: string }[] };
}

export interface StoredJudgment {
  path: string;
  commit: string;
  judgment: GodFileJudgment;
  judgedAt: string;
  durationMilliseconds: number;
}

export interface GodFileJudgesOptions {
  storageFolder: string;
  runClaude: RunClaude;
  language: () => string;
  now?: () => Date;
}

export class GodFileJudges {
  private readonly copies: HeadCopies;
  private readonly now: () => Date;

  constructor(private readonly options: GodFileJudgesOptions) {
    this.copies = new HeadCopies(path.join(options.storageFolder, "head-copies"));
    this.now = options.now ?? (() => new Date());
  }

  // The judgment of the file at this commit, if the owner asked for one.
  judgmentOf(repoFolder: string, repoPath: string, commit: string): StoredJudgment | undefined {
    const file = this.judgmentFile(repoFolder, repoPath, commit);
    return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as StoredJudgment) : undefined;
  }

  async judge(repoFolder: string, item: GodFileItem, report: GodFileReport): Promise<StoredJudgment> {
    const repoPath = requireRepoPath(item.path);
    const copy = await this.copies.copyOf(repoFolder);
    if (copy.commit !== report.commit) {
      throw new Error(`HEAD moved since the god files were measured (${report.commit.slice(0, 7)}, now ${copy.commit.slice(0, 7)}). Refresh God Files, then judge again.`);
    }
    const fileInCopy = path.join(copy.folder, repoPath);
    if (!fs.existsSync(fileInCopy)) {
      throw new Error(`${repoPath} is not in the commit ${copy.commit.slice(0, 7)}.`);
    }
    const contextFolder = await this.writeContext(repoFolder, item, report);
    const run = await this.options.runClaude<unknown>({
      prompt: godFileJudgePrompt(item, { commit: copy.commit, contextFolder, language: this.options.language(), days: report.days }),
      schema: godFileJudgeSchema,
      workingDirectory: copy.folder,
      readableFolders: [contextFolder],
    });
    const lineCount = fs.readFileSync(fileInCopy, "utf8").split("\n").length;
    const stored: StoredJudgment = {
      path: repoPath,
      commit: copy.commit,
      judgment: checkedJudgment(run.answer, lineCount),
      judgedAt: this.now().toISOString(),
      durationMilliseconds: run.durationMilliseconds,
    };
    const file = this.judgmentFile(repoFolder, repoPath, copy.commit);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(stored, null, 2));
    return stored;
  }

  // Claude gets no git: the extension writes the file's commit subjects and its numbers where
  // Claude may read them.
  private async writeContext(repoFolder: string, item: GodFileItem, report: GodFileReport): Promise<string> {
    const contextFolder = path.join(this.options.storageFolder, "god-file-context", folderKey(repoFolder), pathKey(item.path));
    fs.mkdirSync(contextFolder, { recursive: true });
    const headTimeSeconds = Number((await readGit(repoFolder, ["show", "-s", "--format=%ct", report.commit])).trim());
    const since = headTimeSeconds - report.days * 24 * 60 * 60;
    const subjects = await readGit(repoFolder, ["--literal-pathspecs", "log", "--no-merges", "--format=%h %ad %s", "--date=short", `--since=@${since}`, report.commit, "--", item.path]);
    fs.writeFileSync(path.join(contextFolder, "history.txt"), `# Commits of the last ${report.days} days before ${report.commit.slice(0, 7)} that touched ${item.path}, newest first\n${subjects}`);
    fs.writeFileSync(path.join(contextFolder, "numbers.txt"), numbersText(item, report.days));
    return contextFolder;
  }

  private judgmentFile(repoFolder: string, repoPath: string, commit: string): string {
    return path.join(this.options.storageFolder, "god-file-judgments", folderKey(repoFolder), pathKey(repoPath), `${commit}.json`);
  }
}

function pathKey(repoPath: string): string {
  return createHash("sha256").update(repoPath).digest("hex").slice(0, 16);
}

function requireRepoPath(written: string): string {
  const repoPath = cleanRelativePath(written);
  if (repoPath === undefined) {
    throw new Error(`${written} is not a path inside the repo.`);
  }
  return repoPath;
}

// Only what the schema allows is kept, and an answer outside it is refused with what was wrong, so no
// made-up verdict reaches the store or the panel. A line that is not a line of the file is dropped.
export function checkedJudgment(answer: unknown, lineCount: number): GodFileJudgment {
  const reader = new AnswerReader(answer);
  const verdict = reader.oneOf("verdict", godFileVerdicts);
  const keepOrSplit = reader.object("keepOrSplit");
  const decision = keepOrSplit.oneOf("decision", ["keep whole", "split"] as const);
  if (decision === "split" && verdict !== "god_file") {
    throw new Error(`Claude Code proposed a split for a file it called ${verdict}; a split is only for a god file. Judge again.`);
  }
  const namesUsedOutside = reader.object("namesUsedOutside");
  return {
    verdict,
    verdictWhy: reader.text("verdictWhy"),
    responsibilities: reader.list("responsibilities").map((entry) => ({
      name: entry.text("name"),
      startLine: lineOrUndefined(entry.integer("startLine"), lineCount),
      endLine: lineOrUndefined(entry.integer("endLine"), lineCount),
      mainFunctions: entry.texts("mainFunctions"),
    })),
    reasonsToChange: reader.list("reasonsToChange").map((entry) => ({ theme: entry.text("theme"), commits: entry.integer("commits") })),
    namesUsedOutside: {
      justified: namesUsedOutside.list("justified").map((entry) => ({ name: entry.text("name"), why: entry.text("why") })),
      notJustified: namesUsedOutside.list("notJustified").map((entry) => ({ name: entry.text("name"), why: entry.text("why") })),
    },
    readingPath: reader.list("readingPath").map((entry) => ({ name: entry.text("name"), line: lineOrUndefined(entry.integer("line"), lineCount), why: entry.text("why") })),
    keepOrSplit: {
      decision,
      why: keepOrSplit.text("why"),
      modules: decision === "keep whole" ? [] : keepOrSplit.list("modules").map((entry) => ({ name: entry.text("name"), moves: entry.text("moves"), interface: entry.text("interface") })),
    },
  };
}

function lineOrUndefined(line: number, lineCount: number): number | undefined {
  return line >= 1 && line <= lineCount ? line : undefined;
}

class AnswerReader {
  constructor(private readonly value: unknown, private readonly where = "the answer") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`Claude Code's judgment is not what the schema asks for: ${where} is not an object.`);
    }
  }

  private field(name: string): unknown {
    return (this.value as Record<string, unknown>)[name];
  }

  private refuse(name: string, expected: string): never {
    throw new Error(`Claude Code's judgment is not what the schema asks for: ${this.where}.${name} is not ${expected} (${JSON.stringify(this.field(name))?.slice(0, 100)}).`);
  }

  text(name: string): string {
    const value = this.field(name);
    return typeof value === "string" ? value : this.refuse(name, "a text");
  }

  integer(name: string): number {
    const value = this.field(name);
    return Number.isInteger(value) ? (value as number) : this.refuse(name, "a whole number");
  }

  oneOf<T extends string>(name: string, allowed: readonly T[]): T {
    const value = this.field(name);
    return allowed.includes(value as T) ? (value as T) : this.refuse(name, `one of ${allowed.join(", ")}`);
  }

  texts(name: string): string[] {
    const value = this.field(name);
    return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : this.refuse(name, "a list of texts");
  }

  object(name: string): AnswerReader {
    return new AnswerReader(this.field(name), `${this.where}.${name}`);
  }

  list(name: string): AnswerReader[] {
    const value = this.field(name);
    return Array.isArray(value) ? value.map((entry, index) => new AnswerReader(entry, `${this.where}.${name}[${index}]`)) : this.refuse(name, "a list");
  }
}
