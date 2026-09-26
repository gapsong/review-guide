import * as fs from "fs";
import * as path from "path";
import { RunClaude } from "../claude/claudeCli";
import { deepCheckPrompt } from "../claude/deepCheckPrompt";
import { deepCheckSchema } from "../claude/schemas";
import { PullRequestReview, sortingOf } from "../review/pullRequestReview";
import { ReviewUnit } from "../review/reviewUnit";
import { AnalysisCache } from "../state/analysisCache";
import { BlockingProblem, DeepCheck, Evidence, Question } from "./deepCheck";
import { RunRecord } from "./sorting";

// Several units per Claude call keeps the shared context (callers, tests) warm; a few calls at
// once keep a large PR from taking an hour.
const unitsPerCall = 4;
const callsAtOnce = 3;

// Pass 2: a deep check of each critical unit. Each finished unit is stored at once, so the guide
// can show it while the others are still running.
export async function runDeepCheckPass(
  review: PullRequestReview,
  units: ReviewUnit[],
  cache: AnalysisCache,
  runClaude: RunClaude,
  onUnitChecked: () => void,
): Promise<{ runs: RunRecord[]; failures: string[] }> {
  const unchecked = units.filter((unit) => !cache.readDeepCheck(review.pullRequest, unit.hash));
  if (unchecked.length === 0) {
    return { runs: [cacheHit()], failures: [] };
  }
  const runs: RunRecord[] = [];
  const failures: string[] = [];
  const checkBatch = async (batch: ReviewUnit[]) => {
    const { checks, run } = await askClaude(review, batch, runClaude);
    runs.push(run);
    const withoutQuestion = batch.filter((unit) => (checks.get(unit)?.questions.length ?? 0) === 0);
    if (withoutQuestion.length > 0) {
      // Asked once more, on their own: a unit in a batch sometimes gets no question.
      const retry = await askClaude(review, withoutQuestion, runClaude);
      runs.push(retry.run);
      retry.checks.forEach((check, unit) => checks.set(unit, check));
    }
    for (const unit of batch) {
      cache.writeDeepCheck(review.pullRequest, unit.hash, withDefaultQuestion(unit, checks.get(unit)));
      onUnitChecked();
    }
  };
  const checkBatchOrNoteFailure = async (batch: ReviewUnit[]) => {
    try {
      await checkBatch(batch);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  };
  await runAtMost(callsAtOnce, chunks(unchecked, unitsPerCall).map((batch) => () => checkBatchOrNoteFailure(batch)));
  return { runs, failures };
}

interface RawDeepCheck {
  id: string;
  plainWords: string;
  blockingProblems: BlockingProblem[];
  questions: { text: string; startLine: number; endLine: number }[];
  checked: Evidence[];
  onlyYouCanCheck: string[];
  unconfirmed: string[];
}

async function askClaude(review: PullRequestReview, batch: ReviewUnit[], runClaude: RunClaude) {
  const units = batch.map((unit, index) => ({ shortId: `U${index + 1}`, unit, reason: sortingOf(review, unit)?.reason ?? "" }));
  const claudeRun = await runClaude<{ units: RawDeepCheck[] }>({
    prompt: deepCheckPrompt({ pullRequest: review.pullRequest, profile: review.profile, units, contextFolder: review.contextFolder }),
    schema: deepCheckSchema,
    workingDirectory: review.checkout.worktreePath,
    readableFolders: [review.contextFolder],
  });
  const checks = new Map<ReviewUnit, DeepCheck>();
  for (const raw of claudeRun.answer.units) {
    const unit = units.find(({ shortId }) => shortId === raw.id.trim())?.unit;
    if (unit) {
      checks.set(unit, toDeepCheck(raw, unit, lineCountOf(review, unit)));
    }
  }
  const run: RunRecord = {
    pass: "deep check",
    durationMilliseconds: claudeRun.durationMilliseconds,
    inputTokens: claudeRun.inputTokens,
    outputTokens: claudeRun.outputTokens,
    fromCache: false,
  };
  return { checks, run };
}

function toDeepCheck(raw: RawDeepCheck, unit: ReviewUnit, lineCount: number): DeepCheck {
  return {
    plainWords: raw.plainWords,
    blockingProblems: raw.blockingProblems,
    questions: raw.questions
      .filter((question) => question.text.trim() !== "")
      .map((question) => ({
        text: question.text.trim(),
        file: unit.file,
        lines: lineRangeInFile(question.startLine, question.endLine, lineCount),
        isDefault: false,
      })),
    checked: raw.checked,
    onlyYouCanCheck: raw.onlyYouCanCheck,
    unconfirmed: raw.unconfirmed,
  };
}

// Claude's line numbers are kept inside the file, so every question points at real lines.
function lineRangeInFile(startLine: number, endLine: number, lineCount: number) {
  const clamp = (line: number) => Math.min(Math.max(1, Math.round(line)), Math.max(1, lineCount));
  const [start, end] = [clamp(startLine), clamp(endLine)].sort((a, b) => a - b);
  return { start, end };
}

// Every critical unit gets at least one question (F4); when Claude gave none, the extension asks
// the one question that always applies, and says that it is the default.
function withDefaultQuestion(unit: ReviewUnit, check: DeepCheck | undefined): DeepCheck {
  const found: DeepCheck = check ?? {
    plainWords: "",
    blockingProblems: [],
    questions: [],
    checked: [],
    onlyYouCanCheck: [],
    unconfirmed: ["Claude gave no deep check for this unit."],
  };
  if (found.questions.length > 0) {
    return found;
  }
  const defaultQuestion: Question = {
    text: `Check: can you say what lines ${unit.newRange.start}-${unit.newRange.end} do, and why they are correct?`,
    file: unit.file,
    lines: unit.newRange,
    isDefault: true,
  };
  return { ...found, questions: [defaultQuestion] };
}

function lineCountOf(review: PullRequestReview, unit: ReviewUnit): number {
  const filePath = path.join(review.checkout.worktreePath, unit.file);
  if (!fs.existsSync(filePath)) {
    return 1;
  }
  return fs.readFileSync(filePath, "utf8").split("\n").length;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function runAtMost(limit: number, tasks: (() => Promise<void>)[]): Promise<void> {
  const queue = [...tasks];
  const worker = async () => {
    for (let task = queue.shift(); task; task = queue.shift()) {
      await task();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}

function cacheHit(): RunRecord {
  return { pass: "deep check", durationMilliseconds: 0, inputTokens: 0, outputTokens: 0, fromCache: true };
}
