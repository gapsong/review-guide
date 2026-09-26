import { PullRequest } from "../github/pullRequest";
import { ReviewUnit, unitDiffText, unitTitle } from "../review/reviewUnit";

export interface OverviewPromptInput {
  pullRequest: PullRequest;
  commitMessages: string;
  // The repo's .review-guide.md, if it has one.
  profile: string | undefined;
  unitsToSort: { shortId: string; unit: ReviewUnit }[];
  // Units sorted in an earlier run whose change is the same; listed so the summary covers the whole PR.
  unchangedUnits: ReviewUnit[];
  contextFolder: string;
}

export function overviewPrompt(input: OverviewPromptInput): string {
  return [
    "Review Guide pass: overview",
    role,
    tierRules(input.profile),
    outputRules(input.profile),
    tools(input.contextFolder),
    pullRequestSection(input),
    unitsSection(input),
  ].join("\n\n");
}

const role = `You pre-sort a GitHub pull request for its human reviewer, the reviewer. You do not review it for him: you sort his attention, and the merge stays his. Never call a change good or safe.

Sort by the damage a quiet bug in each change would do, not by how hard the code looks. A one-line change to a default or a formula can be critical; a long refactor of logging code is not.`;

function tierRules(profile: string | undefined): string {
  const repoRules = profile
    ? `The repo's profile (.review-guide.md, written by the reviewer) says what matters in this repo. It overrides the general rules:\n\n${profile.trim()}`
    : `The repo has no profile, so use the general rules.`;
  return `Tiers:
- critical: a quiet bug here would do real damage, so a human must read it line by line. In general: auth, security, money, persistence and file formats, math and numerics, public API and defaults, concurrency, and weakened tests.
- check: worth a look, but a bug would be loud or cheap. In general: complex logic without those risks, new tests, new dependencies.
- skim: documentation, comments, renames, formatting, log messages.

A test change that removes an assertion, loosens a tolerance or adds a skip is always critical: it changes the scoreboard.

${repoRules}

Keep critical for the places where a human must look. If everything is critical, nothing is.`;
}

function outputRules(profile: string | undefined): string {
  const draft = profile
    ? ""
    : `\n- draftProfile: the repo has no .review-guide.md, so write a short draft of one from what you see (sections "## Critical", "## Source of truth", "## Skim"). The reviewer edits it and saves it himself.`;
  return `Answer with:
- summary: what this PR does, in 3 to 5 plain sentences.
- units: every unit id listed below, each with exactly one tier and one sentence why. The sentence names the concrete risk ("Fold formula: does z - delta/s still hold when s is clamped?"), not a category ("math code").
- worthHaving: only for a change that adds complexity or API surface for little gain; say why in one sentence. Leave it out otherwise. This is a judgment call for the reviewer, not a bug.
- readingOrder: the unit ids in the order the reviewer should read them, critical first.${draft}`;
}

function tools(contextFolder: string): string {
  return `You run in a checkout of the PR head, with read-only tools (Read, Grep, Glob). The diffs below are usually enough for this pass; read files only when a unit cannot be sorted from its diff, and keep this pass quick. The folder ${contextFolder} holds the full diff, the PR description and the git history of the changed files.`;
}

function pullRequestSection(input: OverviewPromptInput): string {
  const { pullRequest } = input;
  return `# Pull request #${pullRequest.number}: ${pullRequest.title}
${pullRequest.headRef} -> ${pullRequest.baseRef}

## Description
${pullRequest.body.trim() || "(none)"}

## Commit messages
${input.commitMessages.trim() || "(none)"}`;
}

function unitsSection(input: OverviewPromptInput): string {
  const blocks = input.unitsToSort.map(({ shortId, unit }) => unitBlock(shortId, unit));
  const unchanged = input.unchangedUnits.length === 0
    ? ""
    : `\n\n## Also in this PR, already sorted (context only, do not answer for these)\n${input.unchangedUnits.map((unit) => `- ${unit.file}: ${unitTitle(unit)}`).join("\n")}`;
  return `## Units to sort (${input.unitsToSort.length})\n\n${blocks.join("\n\n")}${unchanged}`;
}

function unitBlock(shortId: string, unit: ReviewUnit): string {
  const test = unit.isTestFile ? "  [test file]" : "";
  return `### ${shortId}: ${unit.file}  ${unitTitle(unit)}  (new lines ${unit.newRange.start}-${unit.newRange.end})${test}
\`\`\`diff
${unitDiffText(unit)}
\`\`\``;
}
