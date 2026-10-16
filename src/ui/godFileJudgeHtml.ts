import { GodFileJudgment, StoredJudgment } from "../analysis/godFileJudge";
import { GodFileItem } from "../godfiles/godFiles";
import { numbersLine, ownersRule } from "./godFileText";
import { escapeHtml } from "./markdown";

// The Judge with Claude panel for one file. Pure: takes what to show, returns HTML.
//
// Every text of Claude's judgment is escaped; no part of it becomes markup, a script or a link
// target. A link to the code is a number: the index of a location the extension built from a
// checked pair (the judged file, a line inside it), so the model never names what a click opens.

export type JudgeWork = "idle" | "judging";

export interface JudgePanelModel {
  item: GodFileItem;
  days: number;
  commit: string;
  stored: StoredJudgment | undefined;
  work: JudgeWork;
  // The last run's error, in plain words.
  error: string | undefined;
}

// Where a code link of the panel goes: always the judged file, at a checked line.
export interface CodeLocation {
  path: string;
  line: number;
}

export type JudgePanelMessage = { type: "judge" } | { type: "openLocation"; index: number };

const verdictTitles: Record<GodFileJudgment["verdict"], string> = {
  god_file: "God file",
  deep_module: "Deep module",
  hub: "Hub",
  ok: "OK",
};

// The HTML and the code locations its links point to, by index.
export function renderJudgePanel(model: JudgePanelModel, nonce: string, cspSource: string): { html: string; locations: CodeLocation[] } {
  const locations: CodeLocation[] = [];
  const linkTo = (line: number | undefined, text: string): string => {
    if (line === undefined) {
      return escapeHtml(text);
    }
    locations.push({ path: model.item.path, line });
    return `<a href="#" data-location="${locations.length - 1}">${escapeHtml(text)}</a>`;
  };
  const body = model.stored ? judgmentHtml(model.stored, linkTo) : "";
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>${styles}</style>
</head>
<body>
<header>
<h2>${escapeHtml(model.item.path)}${model.item.hint ? ` <span class="hint">${escapeHtml(model.item.hint)}</span>` : ""}</h2>
<p class="muted">${escapeHtml(numbersLine(model.item, model.days))} · at ${escapeHtml(model.commit.slice(0, 7))}</p>
<p class="rule">${escapeHtml(ownersRule)}</p>
<p>${actionHtml(model)}</p>
${model.error ? `<p class="error">${escapeHtml(model.error)}</p>` : ""}
</header>
<main>
${body}
</main>
<script nonce="${nonce}">${panelScript}</script>
</body>
</html>`;
  return { html, locations };
}

function actionHtml(model: JudgePanelModel): string {
  if (model.work === "judging") {
    return `<button disabled>Judging…</button> <span class="muted">One read-only Claude Code run in a copy of HEAD; it takes a minute or two.</span>`;
  }
  const title = model.stored ? "Judge again" : "Judge with Claude";
  const note = model.stored ? `Judged ${escapeHtml(model.stored.judgedAt.slice(0, 10))} in ${Math.round(model.stored.durationMilliseconds / 1000)} s.` : "Claude reads the file in a copy of HEAD, read-only, and only when you press the button.";
  return `<button data-judge>${title}</button> <span class="muted">${note}</span>`;
}

function judgmentHtml(stored: StoredJudgment, linkTo: (line: number | undefined, text: string) => string): string {
  const { judgment } = stored;
  return `<section>
<h3>Verdict: <span class="verdict ${judgment.verdict}">${escapeHtml(verdictTitles[judgment.verdict])}</span></h3>
<p>${escapeHtml(judgment.verdictWhy)}</p>
</section>
<section>
<h3>Responsibilities</h3>
<ul>${judgment.responsibilities.map((responsibility) => `<li><strong>${escapeHtml(responsibility.name)}</strong> ${linkTo(responsibility.startLine, lineRange(responsibility.startLine, responsibility.endLine))}${responsibility.mainFunctions.length ? `: ${responsibility.mainFunctions.map((name) => `<code>${escapeHtml(name)}</code>`).join(", ")}` : ""}</li>`).join("")}</ul>
</section>
<section>
<h3>Reasons to change</h3>
<ul>${judgment.reasonsToChange.map((reason) => `<li>${escapeHtml(reason.theme)} <span class="muted">(${reason.commits} ${reason.commits === 1 ? "commit" : "commits"})</span></li>`).join("")}</ul>
</section>
<section>
<h3>Names used outside</h3>
<h4>Justified</h4>
${namedList(judgment.namesUsedOutside.justified)}
<h4>Not justified</h4>
${namedList(judgment.namesUsedOutside.notJustified)}
</section>
<section>
<h3>Reading path</h3>
<ol>${judgment.readingPath.map((step) => `<li>${linkTo(step.line, step.name)}${step.line === undefined ? "" : ` <span class="muted">line ${step.line}</span>`}: ${escapeHtml(step.why)}</li>`).join("")}</ol>
</section>
<section>
<h3>${judgment.keepOrSplit.decision === "split" ? "Split" : "Keep whole"}</h3>
<p>${escapeHtml(judgment.keepOrSplit.why)}</p>
${judgment.keepOrSplit.modules.length ? `<ul>${judgment.keepOrSplit.modules.map((module) => `<li><strong>${escapeHtml(module.name)}</strong>: ${escapeHtml(module.moves)}<br><span class="muted">Interface:</span> ${escapeHtml(module.interface)}</li>`).join("")}</ul>` : ""}
</section>`;
}

function namedList(entries: { name: string; why: string }[]): string {
  if (entries.length === 0) {
    return `<p class="muted">None.</p>`;
  }
  return `<ul>${entries.map((entry) => `<li><code>${escapeHtml(entry.name)}</code>: ${escapeHtml(entry.why)}</li>`).join("")}</ul>`;
}

function lineRange(start: number | undefined, end: number | undefined): string {
  if (start === undefined) {
    return "";
  }
  return end === undefined || end === start ? `line ${start}` : `lines ${start}-${end}`;
}

// Only this script runs. It sends a fixed message for the button and a number for a code link.
const panelScript = `
const vscode = acquireVsCodeApi();
document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest("[data-judge], [data-location]") : null;
  if (!target) {
    return;
  }
  event.preventDefault();
  if (target.hasAttribute("data-judge")) {
    vscode.postMessage({ type: "judge" });
  } else {
    vscode.postMessage({ type: "openLocation", index: Number(target.getAttribute("data-location")) });
  }
});`;

const styles = `
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 16px 24px; line-height: 1.5; }
.muted { color: var(--vscode-descriptionForeground); }
.rule { font-style: italic; }
.hint { font-size: 0.8em; padding: 1px 6px; border-radius: 3px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
.error { color: var(--vscode-errorForeground); }
.verdict.god_file { color: var(--vscode-errorForeground); }
.verdict.deep_module { color: var(--vscode-testing-iconPassed); }
button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; cursor: pointer; }
button[disabled] { opacity: 0.6; cursor: default; }
a { color: var(--vscode-textLink-foreground); }
code { font-family: var(--vscode-editor-font-family); }
section { margin-top: 12px; }
`;
