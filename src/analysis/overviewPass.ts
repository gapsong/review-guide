import { RunClaude } from "../claude/claudeCli";
import { overviewPrompt } from "../claude/overviewPrompt";
import { overviewSchema } from "../claude/schemas";
import { PullRequestReview } from "../review/pullRequestReview";
import { ReviewUnit } from "../review/reviewUnit";
import { AnalysisCache, CachedOverview } from "../state/analysisCache";
import { RunRecord, Tier, UnitSorting } from "./sorting";

// A large PR is sorted in parts of about this many units, all at once: one call for 300 units
// takes minutes, and the overview should be there within two (SPEC.md, Q3).
const unitsPerPart = 80;

export interface Part {
  number: number;
  count: number;
}

// Pass 1: every unit gets a tier and a reason, and the PR gets a summary and a reading order.
// Units whose change was already sorted come from the cache; Claude is asked only about the rest.
export async function runOverviewPass(review: PullRequestReview, cache: AnalysisCache, runClaude: RunClaude): Promise<{ overview: CachedOverview; runs: RunRecord[] }> {
  const cached = cache.readOverview(review.pullRequest);
  const unsorted = review.units.filter((unit) => !cached?.sortingsByHash[unit.hash]);
  if (cached && unsorted.length === 0) {
    return { overview: cached, runs: [cacheHit()] };
  }
  const parts = splitIntoParts(unsorted, unitsPerPart);
  const results = await Promise.all(
    parts.map((units, index) => askClaude(review, units, { number: index + 1, count: parts.length }, runClaude)),
  );
  const overview = mergeAnswer(review, cached, unsorted, combineParts(results.map((result) => result.answer)));
  cache.writeOverview(review.pullRequest, overview);
  return { overview, runs: results.map((result) => result.run) };
}

// Splits into as few parts as the size allows, of about equal size. The units of one file stay in
// the same part, so Claude sees a file's changes together; a part can therefore end up a bit larger.
export function splitIntoParts(units: ReviewUnit[], maximumPartSize: number): ReviewUnit[][] {
  const partCount = Math.ceil(units.length / maximumPartSize);
  const targetSize = Math.ceil(units.length / partCount);
  const parts: ReviewUnit[][] = [[]];
  for (const fileUnits of groupByFile(units)) {
    const current = parts[parts.length - 1];
    const mayStartPart = parts.length < partCount;
    if (mayStartPart && current.length > 0 && current.length + fileUnits.length > targetSize) {
      parts.push([...fileUnits]);
    } else {
      current.push(...fileUnits);
    }
  }
  return parts;
}

function groupByFile(units: ReviewUnit[]): ReviewUnit[][] {
  const byFile = new Map<string, ReviewUnit[]>();
  for (const unit of units) {
    byFile.set(unit.file, [...(byFile.get(unit.file) ?? []), unit]);
  }
  return [...byFile.values()];
}

interface OverviewAnswer {
  summary: string;
  readingOrder: string[];
  units: { id: string; tier: Tier; reason: string; worthHaving?: string }[];
  draftProfile?: string;
}

async function askClaude(review: PullRequestReview, units: ReviewUnit[], part: Part, runClaude: RunClaude): Promise<{ answer: SortedAnswer; run: RunRecord }> {
  const unitsToSort = units.map((unit, index) => ({ shortId: `U${index + 1}`, unit }));
  const contextUnits = review.units.filter((unit) => !units.includes(unit));
  const claudeRun = await runClaude<OverviewAnswer>({
    prompt: overviewPrompt({
      pullRequest: review.pullRequest,
      commitMessages: review.commitMessages,
      profile: review.profile,
      unitsToSort,
      contextUnits,
      part,
      contextFolder: review.contextFolder,
    }),
    schema: overviewSchema,
    workingDirectory: review.checkout.worktreePath,
    readableFolders: [review.contextFolder],
  });
  const unitByShortId = new Map(unitsToSort.map(({ shortId, unit }) => [shortId, unit]));
  const answer = withUnitIds(claudeRun.answer, unitByShortId);
  const run: RunRecord = {
    pass: "overview",
    durationMilliseconds: claudeRun.durationMilliseconds,
    inputTokens: claudeRun.inputTokens,
    outputTokens: claudeRun.outputTokens,
    fromCache: false,
  };
  return { answer, run };
}

interface SortedAnswer {
  summary: string;
  readingOrder: string[];
  sortings: Map<ReviewUnit, UnitSorting>;
  draftProfile: string | undefined;
}

// Claude answers with the short ids of the prompt ("U3"); this maps them back to units.
function withUnitIds(answer: OverviewAnswer, unitByShortId: Map<string, ReviewUnit>): SortedAnswer {
  const sortings = new Map<ReviewUnit, UnitSorting>();
  for (const { id, tier, reason, worthHaving } of answer.units) {
    const unit = unitByShortId.get(id.trim());
    if (unit) {
      sortings.set(unit, { tier, reason, ...(worthHaving?.trim() ? { worthHaving: worthHaving.trim() } : {}) });
    }
  }
  const readingOrder = answer.readingOrder
    .map((id) => unitByShortId.get(id.trim())?.id)
    .filter((id): id is string => id !== undefined);
  return { summary: answer.summary, readingOrder, sortings, draftProfile: answer.draftProfile?.trim() || undefined };
}

// The summary and the draft profile come from part 1; the other parts only sort their units.
function combineParts(answers: SortedAnswer[]): SortedAnswer {
  const sortings = new Map<ReviewUnit, UnitSorting>();
  for (const answer of answers) {
    answer.sortings.forEach((sorting, unit) => sortings.set(unit, sorting));
  }
  return {
    summary: answers[0].summary,
    readingOrder: answers.flatMap((answer) => answer.readingOrder),
    sortings,
    draftProfile: answers[0].draftProfile,
  };
}

function mergeAnswer(
  review: PullRequestReview,
  cached: CachedOverview | undefined,
  unsorted: ReviewUnit[],
  answer: SortedAnswer,
): CachedOverview {
  const sortingsByHash = { ...(cached?.sortingsByHash ?? {}) };
  for (const unit of unsorted) {
    const sorting = answer.sortings.get(unit);
    if (sorting) {
      sortingsByHash[unit.hash] = sorting;
    }
  }
  const newlySorted = new Set(answer.readingOrder);
  const earlierOrder = (cached?.readingOrder ?? []).filter((id) => !newlySorted.has(id));
  return {
    headSha: review.checkout.headSha,
    summary: answer.summary,
    readingOrder: [...answer.readingOrder, ...earlierOrder],
    draftProfile: answer.draftProfile ?? cached?.draftProfile,
    sortingsByHash,
  };
}

function cacheHit(): RunRecord {
  return { pass: "overview", durationMilliseconds: 0, inputTokens: 0, outputTokens: 0, fromCache: true };
}
