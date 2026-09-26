import { RunClaude } from "../claude/claudeCli";
import { ownershipPrompt } from "../claude/ownershipPrompt";
import { ownershipCheckSchema } from "../claude/schemas";
import { PullRequestReview } from "../review/pullRequestReview";
import { ReviewUnit } from "../review/reviewUnit";
import { OwnershipCheckResult } from "../state/reviewState";
import { RunRecord } from "./sorting";

// Claude compares the reviewer's own explanation of a unit with the code (same read-only call as the passes).
export async function runOwnershipCheck(
  review: PullRequestReview,
  unit: ReviewUnit,
  explanation: string,
  runClaude: RunClaude,
): Promise<{ result: OwnershipCheckResult; run: RunRecord }> {
  const claudeRun = await runClaude<OwnershipCheckResult>({
    prompt: ownershipPrompt(unit, explanation),
    schema: ownershipCheckSchema,
    workingDirectory: review.checkout.worktreePath,
    readableFolders: [review.contextFolder],
  });
  const { verdict, feedback, line } = claudeRun.answer;
  return {
    result: { verdict, feedback, ...(verdict === "not yet" && line ? { line } : {}) },
    run: {
      pass: "ownership check",
      durationMilliseconds: claudeRun.durationMilliseconds,
      inputTokens: claudeRun.inputTokens,
      outputTokens: claudeRun.outputTokens,
      fromCache: false,
    },
  };
}
