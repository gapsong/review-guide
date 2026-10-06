import { badgeOf } from "../codemap/badge";
import { ChangeMarker, changeText } from "../codemap/changeMarkers";
import { CodemapEntry } from "../codemap/codemap";

// The Codemap view's tooltip for one entry, as Markdown: the sentence, the owner's notes, the
// label, whether an explanation exists, and links that run commands. Pure, so it can be tested
// without VS Code; the view wraps it in a trusted MarkdownString.

export interface EntryStatus {
  // When the explanation page was last written; undefined when there is none.
  explanationWritten: Date | undefined;
  // A commit touched the path after the explanation was written.
  explanationOlder: boolean;
  // Set when commits changed the path since the owner confirmed the entry.
  change: ChangeMarker | undefined;
}

export interface TooltipLink {
  title: string;
  // A "command:" link (see codemapTarget.ts).
  link: string;
}

export interface TooltipContent {
  // The file or folder name shown in the tree.
  name: string;
  entry: CodemapEntry;
  status: EntryStatus;
  // Opens the file that "start" points to; undefined when the entry has no "start".
  startLink: string | undefined;
  actions: TooltipLink[];
}

export function codemapTooltip(content: TooltipContent): string {
  const { entry } = content;
  const sections = [
    `${badgeOf(entry)} **${escapeMarkdown(content.name)}**`,
    content.status.change ? `$(warning) **${capitalized(changeText(content.status.change))}**` : "",
    escapeMarkdown(entry.says),
    ...notesOf(content),
    labelLine(entry),
    explanationLine(content.status),
    content.actions.map((action) => `[${escapeMarkdown(action.title)}](${action.link})`).join(" · "),
  ];
  return sections.filter((section) => section !== "").join("\n\n");
}

function notesOf(content: TooltipContent): string[] {
  const { entry } = content;
  const notes: string[] = [];
  if (entry.why !== undefined) {
    notes.push(`**Why it matters:** ${escapeMarkdown(entry.why)}`);
  }
  if (entry.watch !== undefined) {
    notes.push(`**Watch:** ${escapeMarkdown(entry.watch)}`);
  }
  if (entry.start !== undefined) {
    const start = content.startLink ? `[${escapeMarkdown(entry.start)}](${content.startLink})` : escapeMarkdown(entry.start);
    notes.push(`**Start reading:** ${start}`);
  }
  if (entry.mine !== undefined) {
    notes.push(`**In your words:**\n\n${quoted(entry.mine)}`);
  }
  return notes;
}

function labelLine(entry: CodemapEntry): string {
  return entry.deep ? `*${entry.label} · deep module*` : `*${entry.label}*`;
}

function explanationLine(status: EntryStatus): string {
  if (!status.explanationWritten) {
    return "No explanation yet.";
  }
  const older = status.explanationOlder ? ", older than the last change" : "";
  return `Explanation written ${dateOf(status.explanationWritten)}${older}.`;
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Each line of the owner's text stays a line of its own, inside a quote.
function quoted(text: string): string {
  return text.split("\n").map((line) => (line.trim() === "" ? ">" : `> ${escapeMarkdown(line)}  `)).join("\n");
}

// 2026-10-07, in the local time zone.
export function dateOf(date: Date): string {
  const twoDigits = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`;
}

// Every ASCII punctuation character may be escaped in Markdown, so the owner's text is shown as
// written: a "*" stays a star, and "[x](command:...)" never becomes a link.
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()<>#+\-.!|~&$"':;=?@^,/%]/g, "\\$&");
}
