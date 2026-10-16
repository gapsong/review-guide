import { StoredJudgment } from "../analysis/godFileJudge";
import { spacedBadgeOf } from "../codemap/badge";
import { CodemapEntry } from "../codemap/codemap";
import { isClassMember } from "../godfiles/breadth";
import { godFileRules, GodFileItem, isBroad } from "../godfiles/godFiles";
import { escapeMarkdown, TooltipLink } from "./codemapTooltip";
import { button } from "./explainHtml";
import { escapeHtml } from "./markdown";

// What the God Files view says about one file: the line of numbers, the tooltip that explains each
// number, and the "Judge" view of the Explain panel. Pure, so it can be tested without VS Code.

export const ownersRule = "A big file is fine only as a well-designed deep module: few names used outside, one reason to change.";

// "23 names used outside · 66 commits/90 d · changes with 9 areas · 1,176 lines"
export function numbersLine(item: GodFileItem): string {
  return [
    breadthText(item),
    `${formatted(item.commits)} ${plural(item.commits, "commit", "commits")}/${godFileRules.days} d`,
    `changes with ${formatted(item.coChangeAreas.length)} ${plural(item.coChangeAreas.length, "area", "areas")}`,
    `${formatted(item.codeLines)} lines`,
  ].join(" · ");
}

// Breadth that is not measured shows as "–": a 0 would claim nobody uses the file.
function breadthText(item: GodFileItem): string {
  const names = item.namesUsedOutside?.length;
  return names === undefined ? "– names used outside" : `${formatted(names)} ${plural(names, "name", "names")} used outside`;
}

// The codemap calls the file deep, but other files use more of it than a deep module shows.
export function contradictsCodemap(item: GodFileItem, entry: CodemapEntry | undefined): boolean {
  return entry?.deep === true && item.namesUsedOutside !== undefined && isBroad(item.namesUsedOutside.length);
}

export interface GodFileTooltipContent {
  item: GodFileItem;
  entry: CodemapEntry | undefined;
  actions: TooltipLink[];
}

export function godFileTooltip(content: GodFileTooltipContent): string {
  const { item, entry } = content;
  const sections = [
    `**${escapeMarkdown(item.path)}**${item.hint ? ` · *${escapeMarkdown(item.hint)}*` : ""}`,
    contradictsCodemap(item, entry) ? `$(warning) **Your codemap calls this file a deep module, but ${item.namesUsedOutside!.length} of its names are used by other files** (more than ${godFileRules.broadAboveNamesUsedOutside}).` : "",
    entry ? `Codemap: ${spacedBadgeOf(entry)} ${escapeMarkdown(entry.says)} *(${entry.label}${entry.deep ? " · deep module" : ""})*` : "",
    numberLines(item).join("\n"),
    `*${escapeMarkdown(ownersRule)}* ${escapeMarkdown(hintMeaning(item))}`,
    content.actions.map((action) => `[${escapeMarkdown(action.title)}](${action.link})`).join(" · "),
  ];
  return sections.filter((section) => section !== "").join("\n\n");
}

function numberLines(item: GodFileItem): string[] {
  const names = item.namesUsedOutside;
  const breadth = names === undefined
    ? `- **– names used outside:** breadth is measured for TypeScript, JavaScript and Python only; this file ranks on its history.`
    : `- **${breadthText(item)}:** ${names.length === 0 ? "nothing imports it: an entry point, or unused." : `${escapeMarkdown(breadthSplit(names))}. The more names, the broader the interface you must keep stable.`}`;
  return [
    breadth,
    `- **${item.commits} ${plural(item.commits, "commit", "commits")} in ${godFileRules.days} days:** each commit is a reason it had to change.`,
    `- **Changes with ${item.coChangeAreas.length} ${plural(item.coChangeAreas.length, "area", "areas")}**${item.coChangeAreas.length > 0 ? ` (${escapeMarkdown(shortList(item.coChangeAreas))})` : ""}: files that changed in the same commits; many areas mean many unrelated reasons. Commits of more than ${godFileRules.largestCoChangeCommitFiles} files are sweeps and do not count.`,
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

function hintMeaning(item: GodFileItem): string {
  const { broadAboveNamesUsedOutside: broad, deepFromCodeLines, deepAtMostCoChangeAreas } = godFileRules;
  if (item.hint === "deep") {
    return `At most ${broad} names used outside, at least ${deepFromCodeLines} code lines and changes with at most ${deepAtMostCoChangeAreas} areas: it looks like a deep module.`;
  }
  const why = item.hint === "god file?" ? `More than ${broad} names used outside (class members included): maybe several modules in one file.`
    : item.namesUsedOutside?.length === 0 ? "No hint: nothing imports it, so it has no interface to be deep behind."
      : item.namesUsedOutside !== undefined && item.codeLines >= deepFromCodeLines ? `No hint: a narrow interface, but it changes with more than ${deepAtMostCoChangeAreas} areas, so it has more reasons to change than a deep module.`
        : "No hint.";
  return `${why} Judge with Claude for a verdict.`;
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

export interface JudgeModel {
  item: GodFileItem;
  commit: string;
  stored: StoredJudgment | undefined;
  judging: boolean;
}

const verdictTitles: Record<StoredJudgment["judgment"]["verdict"], string> = { god_file: "God file", deep_module: "Deep module", hub: "Hub", ok: "OK" };

// The "Judge" view below the Explain panel's header. Every text of Claude's judgment is escaped; no
// part of it becomes markup, a script or a link target. A code link is a button that opens a line of
// this file, and only a line checked to be inside it (checkedJudgment), so the model never names
// what a click opens.
export function judgeHtml(model: JudgeModel): string {
  const { stored } = model;
  const action = model.judging
    ? `${button("Judging…", { type: "judgeWithClaude" }, "", " disabled")} <span class="muted">One read-only Claude Code run in a copy of HEAD; it takes a minute or two.</span>`
    : `${button(stored ? "Judge again" : "Judge with Claude", { type: "judgeWithClaude" })} <span class="muted">${stored ? `Judged ${escapeHtml(stored.judgedAt.slice(0, 10))} in ${Math.round(stored.durationMilliseconds / 1000)} s.` : "Claude reads the file in a copy of HEAD, read-only, and only when you press the button."}</span>`;
  const lineLink = (label: string, line: number | undefined) => (line === undefined ? escapeHtml(label) : button(label, { type: "openLine", line }, "link"));
  const judgment = stored?.judgment;
  const sections = judgment ? `<h3>Verdict: <span class="verdict verdict-${judgment.verdict}">${escapeHtml(verdictTitles[judgment.verdict])}</span></h3>
<p>${escapeHtml(judgment.verdictWhy)}</p>
<h3>Responsibilities</h3>
<ul>${judgment.responsibilities.map((part) => `<li><strong>${escapeHtml(part.name)}</strong> ${lineLink(lineRange(part.startLine, part.endLine), part.startLine)}</li>`).join("")}</ul>
<h3>Reading path</h3>
<ol>${judgment.readingPath.map((step) => `<li>${lineLink(step.name, step.line)}: ${escapeHtml(step.why)}</li>`).join("")}</ol>
<h3>${judgment.keepOrSplit.decision === "split" ? "Split" : "Keep whole"}</h3>
<p>${escapeHtml(judgment.keepOrSplit.why)}</p>` : "";
  return `<main>
<p class="muted">${escapeHtml(numbersLine(model.item))} · at ${escapeHtml(model.commit.slice(0, 7))}</p>
<p><em>${escapeHtml(ownersRule)}</em></p>
<p>${action}</p>
${sections}
</main>`;
}

export const judgeStyles = `
body { padding: 0 14px 16px; }
main { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); line-height: 1.55; color: var(--vscode-foreground); max-width: 72ch; }
h3 { font-size: 0.85em; margin: 18px 0 4px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground); }
.verdict-god_file { color: var(--vscode-errorForeground); }
.verdict-deep_module { color: var(--vscode-testing-iconPassed); }
button:disabled { opacity: 0.6; cursor: default; }
`;

function lineRange(start: number | undefined, end: number | undefined): string {
  if (start === undefined) {
    return "";
  }
  return end === undefined || end === start ? `line ${start}` : `lines ${start}-${end}`;
}
