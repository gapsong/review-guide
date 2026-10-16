import { spacedBadgeOf } from "../codemap/badge";
import { CodemapEntry } from "../codemap/codemap";
import { isClassMember } from "../godfiles/breadth";
import { GodFileItem, GodFileReport } from "../godfiles/godFiles";
import { SignalName } from "../godfiles/ranking";
import { godFileRules, isBroad } from "../godfiles/rules";
import { escapeMarkdown, TooltipLink } from "./codemapTooltip";

// What the God Files view says about one file: the line of numbers, and the tooltip that explains
// each number. Pure, so it can be tested without VS Code.

export const ownersRule = "A big file is fine only as a well-designed deep module: few names used outside, one reason to change.";

// Breadth that is not measured shows as "–": a 0 would claim nobody uses the file.
export const unknownNumber = "–";

// "23 names used by 41 files · 66 commits/90 d · changes with 9 areas · 1,176 lines"
export function numbersLine(item: GodFileItem, days: number): string {
  return [
    breadthText(item),
    `${formatted(item.commitsInWindow)} ${plural(item.commitsInWindow, "commit", "commits")}/${days} d`,
    `changes with ${formatted(item.coChangeAreas.length)} ${plural(item.coChangeAreas.length, "area", "areas")}`,
    `${formatted(item.codeLines)} lines`,
  ].join(" · ");
}

export function breadthText(item: GodFileItem): string {
  if (item.namesUsedOutside === undefined || item.filesUsingIt === undefined) {
    return `${unknownNumber} names used outside`;
  }
  const names = item.namesUsedOutside.length;
  return `${formatted(names)} ${plural(names, "name", "names")} used by ${formatted(item.filesUsingIt.length)} ${plural(item.filesUsingIt.length, "file", "files")}`;
}

// The codemap calls the file deep, but other files use more of it than a deep module shows.
export function contradictsCodemap(item: GodFileItem, entry: CodemapEntry | undefined): boolean {
  return entry?.deep === true && item.namesUsedOutside !== undefined && isBroad(item.namesUsedOutside.length);
}

export interface GodFileTooltipContent {
  item: GodFileItem;
  report: GodFileReport;
  // 1 for the top of the list.
  rank: number;
  entry: CodemapEntry | undefined;
  actions: TooltipLink[];
}

export function godFileTooltip(content: GodFileTooltipContent): string {
  const { item, report, entry } = content;
  const sections = [
    `**${escapeMarkdown(item.path)}**${item.hint ? ` · *${escapeMarkdown(item.hint)}*` : ""}`,
    contradictsCodemap(item, entry) ? `$(warning) **Your codemap calls this file a deep module, but ${item.namesUsedOutside!.length} of its names are used by other files** (more than ${godFileRules.broadAboveNamesUsedOutside}).` : "",
    entry ? `Codemap: ${spacedBadgeOf(entry)} ${escapeMarkdown(entry.says)} *(${entry.label}${entry.deep ? " · deep module" : ""})*` : "",
    numberLines(item, report.days).join("\n"),
    `**Why it ranks #${content.rank} of ${report.items.length}:** ${escapeMarkdown(rankReason(item))}`,
    `*${escapeMarkdown(ownersRule)}* ${escapeMarkdown(hintMeaning(item))}`,
    content.actions.map((action) => `[${escapeMarkdown(action.title)}](${action.link})`).join(" · "),
  ];
  return sections.filter((section) => section !== "").join("\n\n");
}

function numberLines(item: GodFileItem, days: number): string[] {
  const names = item.namesUsedOutside;
  const breadth = names === undefined
    ? `- **${unknownNumber} names used outside:** breadth is measured for TypeScript, JavaScript and Python only; this file ranks on its history.`
    : `- **${breadthText(item)}:** ${names.length === 0 ? "nothing imports it: an entry point, or unused." : `${escapeMarkdown(breadthSplit(names))}. The more names, the broader the interface you must keep stable.`}`;
  return [
    breadth,
    `- **${item.commitsInWindow} ${plural(item.commitsInWindow, "commit", "commits")} in ${days} days** (${item.commitsInRecentDays} in the last ${godFileRules.recentDays}): each commit is a reason it had to change.`,
    `- **Changes with ${item.coChangePartners.length} other files in ${item.coChangeAreas.length} ${plural(item.coChangeAreas.length, "area", "areas")}**${item.coChangeAreas.length > 0 ? ` (${escapeMarkdown(shortList(item.coChangeAreas))})` : ""}: files that changed in the same commits; many areas mean many unrelated reasons. Commits of more than ${godFileRules.largestCoChangeCommitFiles} files are sweeps and do not count.`,
    `- **${formatted(item.codeLines)} code lines:** shown, but never part of the score.`,
  ];
}

// "other source files import 3 top-level names (a, b, c) and 12 class members (Model.x, …)"
function breadthSplit(names: string[]): string {
  const topLevel = names.filter((name) => !isClassMember(name));
  const members = names.filter(isClassMember);
  const parts = [
    topLevel.length > 0 ? `${topLevel.length} top-level ${plural(topLevel.length, "name", "names")} (${shortList(topLevel)})` : "",
    members.length > 0 ? `${members.length} class ${plural(members.length, "member", "members")} (${shortList(members)})` : "",
  ].filter((part) => part !== "");
  return `other source files import ${parts.join(" and ")}`;
}

const signalTitles: Record<SignalName, string> = {
  namesUsedOutside: "names used outside",
  coChangeAreas: "co-change areas",
  commitsInWindow: "commits",
  coChangePartners: "co-change partners",
};

// "ahead of 95% on names used outside, 80% on co-change areas, …": the score is their mean.
export function rankReason(item: GodFileItem): string {
  const parts = (Object.keys(signalTitles) as SignalName[])
    .filter((name) => item.percentiles[name] !== undefined)
    .map((name) => `${Math.round(item.percentiles[name]! * 100)}% on ${signalTitles[name]}`);
  return `ahead of ${parts.join(", ")} of the measured files; the score is their mean (${Math.round(item.score * 100)}).`;
}

function hintMeaning(item: GodFileItem): string {
  if (item.hint === "god file?") {
    return `More than ${godFileRules.broadAboveNamesUsedOutside} names used outside (class members included): maybe several modules in one file. Judge with Claude for a verdict.`;
  }
  if (item.hint === "deep") {
    return `At most ${godFileRules.broadAboveNamesUsedOutside} names used outside, at least ${godFileRules.deepFromCodeLines} code lines and changes with at most ${godFileRules.deepAtMostCoChangeAreas} areas: it looks like a deep module.`;
  }
  if (item.namesUsedOutside?.length === 0) {
    return "No hint: nothing imports it, so it has no interface to be deep behind. Judge with Claude for a verdict.";
  }
  if (item.namesUsedOutside !== undefined && item.codeLines >= godFileRules.deepFromCodeLines) {
    return `No hint: a narrow interface, but it changes with ${item.coChangeAreas.length} areas (more than ${godFileRules.deepAtMostCoChangeAreas}), so it has more reasons to change than a deep module. Judge with Claude for a verdict.`;
  }
  return "No hint: Judge with Claude for a verdict.";
}

function shortList(values: string[]): string {
  const shown = values.slice(0, 8).join(", ");
  return values.length > 8 ? `${shown} and ${values.length - 8} more` : shown;
}

function formatted(value: number): string {
  return value.toLocaleString("en-US");
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}
