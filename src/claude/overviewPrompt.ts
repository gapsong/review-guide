import { PullRequest } from "../github/pullRequest";
import type { Part } from "../analysis/overviewPass";
import { ReviewUnit, unitDiffText, unitTitle } from "../review/reviewUnit";

export interface OverviewPromptInput {
  pullRequest: PullRequest;
  commitMessages: string;
  // The repo's .review-guide.md, if it has one.
  profile: string | undefined;
  unitsToSort: { shortId: string; unit: ReviewUnit }[];
  // The PR's other units: sorted in an earlier run, or in another part of this one. Listed as
  // context, so the tiers and the summary are judged against the whole PR.
  contextUnits: ReviewUnit[];
  part: Part;
  contextFolder: string;
}

export function overviewPrompt(input: OverviewPromptInput): string {
  return [
    "Review Guide pass: overview",
    role,
    tierRules(input.profile),
    outputRules(input.profile, input.part),
    tools(input.contextFolder),
    pullRequestSection(input),
    unitsSection(input),
  ].join("\n\n");
}

const role = `You pre-sort a GitHub pull request for its human reviewer. You do not review it for them: you sort their attention, and the merge stays theirs. Never call a change good or safe.

Sort by the damage a quiet bug in each change would do, not by how hard the code looks. A one-line change to a default or a formula can be critical; a long refactor of logging code is not.`;

function tierRules(profile: string | undefined): string {
  const repoRules = profile
    ? `The repo's profile (.review-guide.md, written by the repo's owner) says what matters in this repo. It overrides the general rules:\n\n${profile.trim()}`
    : `The repo has no profile, so use the general rules.`;
  return `Tiers:
- critical: a quiet bug here would do real damage, so a human must read it line by line. In general: auth, security, money, persistence and file formats, math and numerics, public API and defaults, concurrency, and weakened tests.
- check: worth a look, but a bug would be loud or cheap. In general: complex logic without those risks, new tests, new dependencies.
- skim: documentation, comments, renames, formatting, log messages.

A test change that removes an assertion, loosens a tolerance or adds a skip is always critical: it changes the scoreboard.

${repoRules}

Keep critical for the few places where a quiet bug does damage and only a line-by-line human read would catch it. A new or changed formula, rounding, clamp, cast or default is critical even when it is small or looks like a helper. A change that only calls another change without logic of its own (a second backend switching to the same helper, a caller passing an argument through) is check; the helper it calls is the critical one. If everything is critical, nothing is.`;
}

function outputRules(profile: string | undefined, part: Part): string {
  const isFirstPart = part.number === 1;
  const draft = profile || !isFirstPart
    ? ""
    : `\n- draftProfile: the repo has no .review-guide.md, so write a short draft of one from what you see (sections "## Critical", "## Source of truth", "## Skim"). The reviewer edits it and saves it themselves.`;
  const parts = part.count === 1
    ? ""
    : `The PR is large, so its units are sorted in ${part.count} parts at the same time; this is part ${part.number}. Sort by the same standard as if you saw the whole PR; the other parts' units are listed at the end.\n\n`;
  const summary = isFirstPart
    ? "what this PR does, in 3 to 5 plain sentences."
    : "leave it empty; part 1 writes it.";
  return `${parts}Answer with:
- summary: ${summary}
- units: every unit id listed below, each with exactly one tier and one short sentence why (at most 20 words). The sentence names the concrete risk ("Fold formula: does z - delta/s still hold when s is clamped?"), not a category ("math code").
- worthHaving: only for a change that adds complexity or API surface for little gain; say why in one sentence. Leave it out otherwise. This is a judgment call for the reviewer, not a bug.
- readingOrder: the ids of the critical and check units, in the order the reviewer should read them, critical first. Leave skim units out.${draft}`;
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
  const context = input.contextUnits.length === 0
    ? ""
    : `\n\n## Also in this PR (context only, do not answer for these)\n${input.contextUnits.map((unit) => `- ${unit.file}: ${unitTitle(unit)}`).join("\n")}`;
  return `## Units to sort (${input.unitsToSort.length})\n\n${blocks.join("\n\n")}${context}`;
}

function unitBlock(shortId: string, unit: ReviewUnit): string {
  const test = unit.isTestFile ? "  [test file]" : "";
  return `### ${shortId}: ${unit.file}  ${unitTitle(unit)}  (new lines ${unit.newRange.start}-${unit.newRange.end})${test}
\`\`\`diff
${unitDiffText(unit)}
\`\`\``;
}
