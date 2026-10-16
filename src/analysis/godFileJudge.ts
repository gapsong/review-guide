import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { RunClaude } from "../claude/claudeCli";
import { godFileJudgePrompt, numbersText } from "../claude/godFileJudgePrompt";
import { godFileJudgeSchema } from "../claude/schemas";
import { runGit } from "../git/git";
import { folderKey, HeadCopies } from "../git/headCopy";
import { godFileRules, GodFileItem, GodFileReport } from "../godfiles/godFiles";

// "Judge with Claude" for one file of the God Files view, without VS Code: one read-only Claude call
// in a copy of the repo's HEAD (the same copies "Check my words" reads), started only by the owner.
// The judgment is checked against its schema and kept per file and HEAD commit in the extension's
// storage; nothing is written into the repo.
//
//   storage/head-copies/<folder>/<commit>/            Claude's working directory (tracked files only)
//   storage/god-file-context/<folder>/<path hash>/   history.txt, numbers.txt (Claude may read)
//   storage/god-file-judgments/<folder>/<path hash>/<commit>.json

export type GodFileVerdict = "god_file" | "deep_module" | "hub" | "ok";

export interface GodFileJudgment {
  verdict: GodFileVerdict;
  verdictWhy: string;
  // A line that is not a line of the file is dropped (undefined), so it never becomes a link.
  responsibilities: { name: string; startLine: number | undefined; endLine: number | undefined }[];
  readingPath: { name: string; line: number | undefined; why: string }[];
  keepOrSplit: { decision: "keep whole" | "split"; why: string };
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
}

export class GodFileJudges {
  private readonly copies: HeadCopies;

  constructor(private readonly options: GodFileJudgesOptions) {
    this.copies = new HeadCopies(path.join(options.storageFolder, "head-copies"));
  }

  // The judgment of the file at this commit, if the owner asked for one.
  judgmentOf(repoFolder: string, repoPath: string, commit: string): StoredJudgment | undefined {
    const file = this.judgmentFile(repoFolder, repoPath, commit);
    return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as StoredJudgment) : undefined;
  }

  async judge(repoFolder: string, item: GodFileItem, report: GodFileReport): Promise<StoredJudgment> {
    const copy = await this.copies.copyOf(repoFolder);
    if (copy.commit !== report.commit) {
      throw new Error(`HEAD moved since the god files were measured (${report.commit.slice(0, 7)}, now ${copy.commit.slice(0, 7)}). Refresh God Files, then judge again.`);
    }
    const contextFolder = await this.writeContext(repoFolder, item, report.commit);
    const run = await this.options.runClaude<unknown>({
      prompt: godFileJudgePrompt(item, { commit: copy.commit, contextFolder, language: this.options.language() }),
      schema: godFileJudgeSchema,
      workingDirectory: copy.folder,
      readableFolders: [contextFolder],
    });
    const lineCount = fs.readFileSync(path.join(copy.folder, item.path), "utf8").split("\n").length;
    const stored: StoredJudgment = {
      path: item.path,
      commit: copy.commit,
      judgment: checkedJudgment(run.answer, lineCount),
      judgedAt: new Date().toISOString(),
      durationMilliseconds: run.durationMilliseconds,
    };
    const file = this.judgmentFile(repoFolder, item.path, copy.commit);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(stored, null, 2));
    return stored;
  }

  // Claude gets no git: the extension writes the file's commit subjects and its numbers where
  // Claude may read them.
  private async writeContext(repoFolder: string, item: GodFileItem, commit: string): Promise<string> {
    const contextFolder = path.join(this.options.storageFolder, "god-file-context", folderKey(repoFolder), pathKey(item.path));
    fs.mkdirSync(contextFolder, { recursive: true });
    const headTimeSeconds = Number((await runGit(["show", "-s", "--format=%ct", commit], { cwd: repoFolder })).trim());
    const since = `--since=@${headTimeSeconds - godFileRules.days * 24 * 60 * 60}`;
    const subjects = await runGit(["--literal-pathspecs", "log", "--no-merges", "--format=%h %ad %s", "--date=short", since, commit, "--", item.path], { cwd: repoFolder });
    fs.writeFileSync(path.join(contextFolder, "history.txt"), `# Commits of the last ${godFileRules.days} days before ${commit.slice(0, 7)} that touched ${item.path}, newest first\n${subjects}`);
    fs.writeFileSync(path.join(contextFolder, "numbers.txt"), numbersText(item));
    return contextFolder;
  }

  private judgmentFile(repoFolder: string, repoPath: string, commit: string): string {
    return path.join(this.options.storageFolder, "god-file-judgments", folderKey(repoFolder), pathKey(repoPath), `${commit}.json`);
  }
}

function pathKey(repoPath: string): string {
  return createHash("sha256").update(repoPath).digest("hex").slice(0, 16);
}

// Only what the schema allows is kept, and an answer outside it is refused, so no made-up verdict
// reaches the store or the panel. A line that is not a line of the file is dropped.
export function checkedJudgment(answer: unknown, lineCount: number): GodFileJudgment {
  const refuse = (what: string): never => {
    throw new Error(`Claude Code's judgment is not what the schema asks for: ${what}.`);
  };
  const fields = (value: unknown, where: string) => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : refuse(`${where} is not an object`));
  const text = (value: unknown, where: string) => (typeof value === "string" ? value : refuse(`${where} is not a text`));
  const list = (value: unknown, where: string) => (Array.isArray(value) ? value.map((entry, index) => fields(entry, `${where}[${index}]`)) : refuse(`${where} is not a list`));
  const oneOf = <T extends string>(value: unknown, allowed: readonly T[], where: string) => (allowed.includes(value as T) ? (value as T) : refuse(`${where} is not one of ${allowed.join(", ")}`));
  const line = (value: unknown) => (Number.isInteger(value) && (value as number) >= 1 && (value as number) <= lineCount ? (value as number) : undefined);
  const judgment = fields(answer, "the answer");
  const keepOrSplit = fields(judgment.keepOrSplit, "keepOrSplit");
  return {
    verdict: oneOf(judgment.verdict, ["god_file", "deep_module", "hub", "ok"] as const, "verdict"),
    verdictWhy: text(judgment.verdictWhy, "verdictWhy"),
    responsibilities: list(judgment.responsibilities, "responsibilities").map((part) => ({ name: text(part.name, "a responsibility's name"), startLine: line(part.startLine), endLine: line(part.endLine) })),
    readingPath: list(judgment.readingPath, "readingPath").map((step) => ({ name: text(step.name, "a step's name"), line: line(step.line), why: text(step.why, "a step's why") })),
    keepOrSplit: { decision: oneOf(keepOrSplit.decision, ["keep whole", "split"] as const, "keepOrSplit.decision"), why: text(keepOrSplit.why, "keepOrSplit.why") },
  };
}
