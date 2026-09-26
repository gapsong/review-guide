import { RunClaude } from "../claude/claudeCli";
import { overviewPrompt } from "../claude/overviewPrompt";
import { overviewSchema } from "../claude/schemas";
import { PullRequestReview } from "../review/pullRequestReview";
import { ReviewUnit } from "../review/reviewUnit";
import { AnalysisCache, CachedOverview } from "../state/analysisCache";
import { RunRecord, Tier, UnitSorting } from "./sorting";

// Pass 1: every unit gets a tier and a reason, and the PR gets a summary and a reading order.
// Units whose change was already sorted come from the cache; Claude is asked only about the rest.
export async function runOverviewPass(review: PullRequestReview, cache: AnalysisCache, runClaude: RunClaude): Promise<{ overview: CachedOverview; run: RunRecord }> {
  const cached = cache.readOverview(review.pullRequest);
  const unsorted = review.units.filter((unit) => !cached?.sortingsByHash[unit.hash]);
  if (cached && unsorted.length === 0) {
    return { overview: cached, run: cacheHit() };
  }
  const { answer, run } = await askClaude(review, unsorted, runClaude);
  const overview = mergeAnswer(review, cached, unsorted, answer);
  cache.writeOverview(review.pullRequest, overview);
  return { overview, run };
}

interface OverviewAnswer {
  summary: string;
  readingOrder: string[];
  units: { id: string; tier: Tier; reason: string; worthHaving?: string }[];
  draftProfile?: string;
}

async function askClaude(review: PullRequestReview, unsorted: ReviewUnit[], runClaude: RunClaude): Promise<{ answer: SortedAnswer; run: RunRecord }> {
  const unitsToSort = unsorted.map((unit, index) => ({ shortId: `U${index + 1}`, unit }));
  const unchangedUnits = review.units.filter((unit) => !unsorted.includes(unit));
  const claudeRun = await runClaude<OverviewAnswer>({
    prompt: overviewPrompt({
      pullRequest: review.pullRequest,
      commitMessages: review.commitMessages,
      profile: review.profile,
      unitsToSort,
      unchangedUnits,
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
