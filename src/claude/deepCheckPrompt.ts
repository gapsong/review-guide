import { PullRequest } from "../github/pullRequest";
import { ReviewUnit, unitDiffText, unitTitle } from "../review/reviewUnit";
import { explanationStyle } from "./explanationStyle";

export interface DeepCheckPromptInput {
  pullRequest: PullRequest;
  profile: string | undefined;
  units: { shortId: string; unit: ReviewUnit; reason: string }[];
  contextFolder: string;
}

export function deepCheckPrompt(input: DeepCheckPromptInput): string {
  return [
    "Review Guide pass: deep check",
    role,
    whatToLookAt(input),
    answerRules,
    explanationStyle,
    `# Pull request #${input.pullRequest.number}: ${input.pullRequest.title}`,
    `## Critical units (${input.units.length})`,
    ...input.units.map(({ shortId, unit, reason }) => unitBlock(shortId, unit, reason)),
  ].join("\n\n");
}

const role = `You help the reviewer, the human reviewer, understand the critical changes of a pull request well enough to own them. You do not review for him and you never say a change looks good. Every claim you make carries its evidence (where you looked); anything you could not confirm, you mark as unconfirmed.`;

function whatToLookAt(input: DeepCheckPromptInput): string {
  const reference = input.profile
    ? `The repo profile names the references the code must match:\n\n${input.profile.trim()}`
    : "The repo has no profile; if the code follows a paper or another implementation, say which and whether you could check it.";
  return `You run in a checkout of the PR head, with read-only tools (Read, Grep, Glob); you cannot run code. For each unit below, look at: the full function before and after (the base version is in the diff; ${input.contextFolder} holds the full diff, PR description and git history), its callers and callees (grep for them), the tests that cover it, and the reference it must match.

${reference}`;
}

const answerRules = `Answer per unit:
- plainWords: what the code does now, in 2-3 plain sentences, so the reviewer understands it before he judges it; add an ASCII diagram and an everyday analogy (mapped back to the code) whenever they help, as described below.
- blockingProblems: only problems you would block the merge for, each with file and line, why it is wrong, and how to show that it fails (an input, a test). Leave it empty rather than list style issues or guesses.
- questions: at least one, each starting with "Check:" (a small ASCII diagram may help here too), about what the reviewer must verify himself, tied to the lines of the new version of the unit's file (startLine, endLine within the unit's new lines where possible).
- checked: what you checked yourself, and where you looked ("read tests/test_packing.py: 3-bit case covered").
- onlyYouCanCheck: what only the reviewer can judge (intent, the paper, hardware, data).
- unconfirmed: anything you could not confirm.`;

function unitBlock(shortId: string, unit: ReviewUnit, reason: string): string {
  return `### ${shortId}: ${unit.file}  ${unitTitle(unit)}  (new lines ${unit.newRange.start}-${unit.newRange.end})
Why it is critical: ${reason}
\`\`\`diff
${unitDiffText(unit)}
\`\`\``;
}
