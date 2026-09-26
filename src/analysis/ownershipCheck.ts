import { RunClaude } from "../claude/claudeCli";
import { ownershipPrompt } from "../claude/ownershipPrompt";
import { ownershipCheckSchema } from "../claude/schemas";
import { PullRequestReview } from "../review/pullRequestReview";
import { ReviewUnit } from "../review/reviewUnit";
import { ChatTurn, OwnershipCheckResult } from "../state/reviewState";
import { RunRecord } from "./sorting";

// One turn of the ownership chat: Claude answers the reviewer's message with the unit, the code and the
// conversation so far as context (same read-only call as the passes), and gives a verdict.
export async function runOwnershipCheck(
  review: PullRequestReview,
  unit: ReviewUnit,
  conversation: ChatTurn[],
  message: string,
  runClaude: RunClaude,
): Promise<{ result: OwnershipCheckResult; run: RunRecord }> {
  const claudeRun = await runClaude<OwnershipCheckResult>({
    prompt: ownershipPrompt(unit, conversation, message),
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
