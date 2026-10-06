import { DeepCheck, Question } from "../analysis/deepCheck";
import { Tier } from "../analysis/sorting";
import { ChatTurn, OwnershipCheckResult, ReadState } from "../state/reviewState";
import { escapeHtml, renderMarkdown } from "./markdown";

// Renders the guide panel. Pure: takes the view model, returns HTML, so it can be tested without VS Code.

export interface GuideModel {
  pullRequestNumber: number;
  file: string;
  title: string;
  lines: string;
  // Missing until pass 1 has sorted the unit.
  tier: Tier | undefined;
  reason: string | undefined;
  worthHaving: string | undefined;
  readState: ReadState;
  changedSinceReview: boolean;
  // Pass 2's result, for critical units once it is there.
  deepCheck: DeepCheck | undefined;
  // The reviewer's own explanation and Claude's verdict on it (critical units).
  explanation: string | undefined;
  // What the reviewer has typed but not sent yet; it must survive the panel being redrawn.
  draft: string | undefined;
  conversation: ChatTurn[];
  checkingExplanation: boolean;
}

// Messages the panel's buttons and links send back to the extension.
export type GuideMessage =
  | { type: "markRead" }
  | { type: "markUnread" }
  | { type: "reveal"; start: number; end: number }
  | { type: "explain"; text: string }
  | { type: "draft"; text: string };

export function renderGuide(model: GuideModel | undefined, nonce: string, cspSource: string): string {
  const body = model ? unitSections(model) : `<p class="muted">Click a change in the side bar to see what to check.</p>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>${styles}</style>
</head>
<body>
${body}
<script nonce="${nonce}">${script}</script>
</body>
</html>`;
}

// What needs the reviewer comes first: the tier, then their questions, then blocking problems.
function unitSections(model: GuideModel): string {
  return [
    heading(model),
    tierSection(model),
    deepCheckSections(model),
    ownershipSection(model),
    plainWordsSection(model),
    readButtons(model),
  ].join("\n");
}

function heading(model: GuideModel): string {
  const changed = model.changedSinceReview ? ` <span class="changed">changed since your review</span>` : "";
  return `<h2>${escapeHtml(model.title)}</h2>
<p class="muted">${escapeHtml(model.file)} · ${escapeHtml(model.lines)} · PR #${model.pullRequestNumber} · <span class="state state-${model.readState}">${model.readState}</span>${changed}</p>`;
}

function tierSection(model: GuideModel): string {
  if (!model.tier) {
    return `<p class="muted">Not sorted yet: pass 1 is running or has failed.</p>`;
  }
  const worthHaving = model.worthHaving
    ? `<p class="worth"><strong>Worth having?</strong> ${escapeHtml(model.worthHaving)}</p>`
    : "";
  return `<p><span class="tier tier-${model.tier}">${model.tier}</span> ${escapeHtml(model.reason ?? "")}</p>${worthHaving}`;
}

function deepCheckSections(model: GuideModel): string {
  if (model.tier !== "critical") {
    return "";
  }
  const check = model.deepCheck;
  if (!check) {
    return `<p class="muted">Pass 2 (deep check) has not reached this unit yet.</p>`;
  }
  return [
    listSection("Questions for you", check.questions.map(questionItem)),
    listSection("Blocking problems", check.blockingProblems.map((problem) =>
      `<strong>${escapeHtml(problem.file)}:${problem.line}</strong> ${escapeHtml(problem.why)}<br><span class="muted">Show it fails: ${escapeHtml(problem.howToShowFailure)}</span>`)),
    listSection("Only you can check", check.onlyYouCanCheck.map(escapeHtml)),
    listSection("Claude checked", check.checked.map((evidence) => `${escapeHtml(evidence.what)} <span class="muted">(${escapeHtml(evidence.where)})</span>`)),
    listSection("Unconfirmed", check.unconfirmed.map(escapeHtml)),
  ].join("\n");
}

function questionItem(question: Question): string {
  const lines = question.lines.start === question.lines.end ? `line ${question.lines.start}` : `lines ${question.lines.start}-${question.lines.end}`;
  const message = escapeHtml(JSON.stringify({ type: "reveal", start: question.lines.start, end: question.lines.end }));
  const isDefault = question.isDefault ? ` <span class="muted">(Claude gave no question; this is the default one)</span>` : "";
  return `${renderMarkdown(question.text)} <a href="#" data-message="${message}">${lines}</a>${isDefault}`;
}

function listSection(title: string, items: string[]): string {
  if (items.length === 0) {
    return "";
  }
  return `<h3>${escapeHtml(title)}</h3>\n<ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>`;
}

// The ownership chat: the reviewer's first try, then as many replies and questions as they need.
function ownershipSection(model: GuideModel): string {
  if (model.tier !== "critical") {
    return "";
  }
  const isFirstTry = model.conversation.length === 0;
  const hint = isFirstTry
    ? `In 1-2 sentences: what does this code do, and why is it correct? Only "understood" marks the unit as understood.`
    : `Answer, try again, or ask back. The verdict can change with every reply; only "understood" counts.`;
  const checking = model.checkingExplanation ? `<p class="muted">Claude is answering...</p>` : "";
  return `<h3>Do you own it?</h3>
${model.conversation.map(chatTurn).join("\n")}
<p class="muted">${hint}</p>
<textarea id="explanation" rows="4">${escapeHtml(model.draft ?? "")}</textarea>
<p><button id="explain"${model.checkingExplanation ? " disabled" : ""}>${isFirstTry ? "Check my explanation" : "Send"}</button></p>
${checking}`;
}

function chatTurn(turn: ChatTurn): string {
  if (turn.speaker === "reviewer") {
    return `<div class="turn turn-reviewer"><strong>You</strong>${renderMarkdown(turn.text)}</div>`;
  }
  const { verdict } = turn.result;
  return `<div class="turn turn-claude"><strong>Claude</strong> <span class="verdict verdict-${verdict.replace(" ", "-")}">${verdict}</span>${renderMarkdown(turn.result.feedback)}${verdictLine(turn.result)}</div>`;
}

function verdictLine(check: OwnershipCheckResult): string {
  if (!check.line) {
    return "";
  }
  const message = escapeHtml(JSON.stringify({ type: "reveal", start: check.line, end: check.line }));
  return ` <a href="#" data-message="${message}">line ${check.line}</a>`;
}

// Claude's own summary stays hidden until the reviewer has written theirs: it must not give them the answer first.
function plainWordsSection(model: GuideModel): string {
  const plainWords = model.deepCheck?.plainWords;
  if (model.tier !== "critical" || !plainWords) {
    return "";
  }
  if (!model.explanation) {
    return `<p class="muted">Claude's plain-words summary opens after you have written your own explanation.</p>`;
  }
  return `<details open><summary>Claude's plain-words summary</summary>${renderMarkdown(plainWords)}</details>`;
}

function readButtons(model: GuideModel): string {
  const message: GuideMessage = model.readState === "unread" ? { type: "markRead" } : { type: "markUnread" };
  const label = model.readState === "unread" ? "Mark as read" : "Mark as unread";
  return `<p><button data-message="${escapeHtml(JSON.stringify(message))}">${label}</button></p>`;
}

const styles = `
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); line-height: 1.55; color: var(--vscode-foreground); padding: 0 12px 16px; max-width: 72ch; }
p { margin: 6px 0; }
strong { font-weight: 600; }
code { font-family: var(--vscode-editor-font-family); font-size: 0.92em; background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; }
h4, h5, h6 { font-size: 1em; margin: 12px 0 4px; }
ol { padding-left: 22px; margin: 4px 0; }
table { border-collapse: collapse; margin: 8px 0; font-size: 0.95em; }
th, td { border: 1px solid var(--vscode-editorWidget-border, var(--vscode-descriptionForeground)); padding: 3px 8px; text-align: left; vertical-align: top; }
th { background: var(--vscode-textCodeBlock-background); font-weight: 600; }
blockquote { margin: 8px 0; padding: 2px 10px; border-left: 3px solid var(--vscode-textBlockQuote-border, var(--vscode-descriptionForeground)); background: var(--vscode-textBlockQuote-background); }
details summary { cursor: pointer; font-weight: 600; margin: 12px 0 4px; }
h2 { font-size: 1.1em; margin: 12px 0 2px; }
h3 { font-size: 0.85em; margin: 16px 0 4px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground); }
ul { padding-left: 18px; margin: 4px 0; }
li { margin: 4px 0; }
.muted { color: var(--vscode-descriptionForeground); margin-top: 0; }
.tier, .state, .changed { display: inline-block; padding: 0 6px; border-radius: 3px; font-size: 0.8em; }
.tier { font-weight: 600; text-transform: uppercase; }
.tier-critical { background: var(--vscode-inputValidation-errorBackground); border: 1px solid var(--vscode-inputValidation-errorBorder); }
.tier-check { background: var(--vscode-inputValidation-warningBackground); border: 1px solid var(--vscode-inputValidation-warningBorder); }
.tier-skim, .state { border: 1px solid var(--vscode-descriptionForeground); }
.state-understood { border-color: var(--vscode-testing-iconPassed); }
.changed { border: 1px solid var(--vscode-inputValidation-warningBorder); }
.worth { border-left: 3px solid var(--vscode-inputValidation-infoBorder); padding-left: 8px; }
pre.diagram { font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); line-height: 1.35; background: var(--vscode-textCodeBlock-background); padding: 8px 10px; border-radius: 4px; overflow-x: auto; white-space: pre; }
.turn { border-left: 3px solid var(--vscode-descriptionForeground); border-radius: 4px; padding: 6px 10px; margin: 10px 0; background: var(--vscode-editorWidget-background); }
.turn-claude { border-left-color: var(--vscode-textLink-foreground); }
.turn > strong:first-child { display: inline-block; margin-bottom: 2px; }
textarea { width: 100%; box-sizing: border-box; font-family: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); }
.verdict { display: inline-block; padding: 0 6px; border-radius: 3px; font-weight: 600; font-size: 0.8em; border: 1px solid var(--vscode-descriptionForeground); }
.verdict-understood { border-color: var(--vscode-testing-iconPassed); }
.verdict-almost { border-color: var(--vscode-inputValidation-warningBorder); }
.verdict-not-yet { border-color: var(--vscode-inputValidation-errorBorder); }
button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 10px; cursor: pointer; }
`;

const script = `
const vscode = acquireVsCodeApi();
document.addEventListener("input", (event) => {
  if (event.target.id === "explanation") {
    vscode.postMessage({ type: "draft", text: event.target.value });
  }
});
document.addEventListener("click", (event) => {
  if (event.target.id === "explain") {
    vscode.postMessage({ type: "explain", text: document.getElementById("explanation").value });
    return;
  }
  const target = event.target.closest("[data-message]");
  if (target) {
    event.preventDefault();
    vscode.postMessage(JSON.parse(target.dataset.message));
  }
});
`;
