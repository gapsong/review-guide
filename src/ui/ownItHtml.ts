import { ChangesSinceCheck } from "../analysis/entryCheck";
import { maximumNoteLengths } from "../codemap/codemap";
import { chatVerdictCounts, EntryChatReply, EntryChatTurn, EntryCheck, OwnershipState } from "../codemap/entryOwnership";
import { EntryWork } from "../codemap/workspaceEntryOwnership";
import { button, ExplainHeader, headerHtml, headerStyles } from "./explainHtml";
import { escapeHtml, renderMarkdown } from "./markdown";
import { shortCommit } from "./ownershipText";

// The Explain panel's second view, "Own it": the owner's words (mine), their last check, the tutor
// chat and what changed since the check. Pure: takes what to show, returns HTML.
//
// It is a document of its own, not a part of the explanation page: only its nonce script runs, so no
// script of a generated page ever sees what the owner types.

export interface OwnItModel {
  mine: string | undefined;
  state: OwnershipState | undefined;
  // The last check, also when the words changed after it.
  lastCheck: EntryCheck | undefined;
  conversation: EntryChatTurn[];
  // What the owner has typed into the reply box and not sent yet.
  draft: string | undefined;
  work: EntryWork | undefined;
  changes: ChangesSinceCheck | undefined;
}

export function renderOwnItPanel(header: ExplainHeader, model: OwnItModel, nonce: string, cspSource: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>${headerStyles}${ownItStyles}</style>
</head>
<body>
${headerHtml({ ...header, mode: "ownIt" })}
<main>
${wordsSection(model)}
${checkSection(model)}
${chatSection(model)}
${changesSection(model)}
</main>
<script nonce="${nonce}">${ownItScript}</script>
</body>
</html>`;
}

function wordsSection(model: OwnItModel): string {
  const edit = button("Edit in codemap", { type: "editInCodemap" }, "secondary");
  if (model.mine === undefined) {
    return `<h3>Your words</h3>
<p class="muted">No words yet. In the codemap, add <code>mine: |</code> to this entry and write on the next lines, indented, how it works in your own words (at most ${maximumNoteLengths.mine} characters). Then check them here.</p>
<p>${edit}</p>`;
  }
  const length = Array.from(model.mine).length;
  const checking = model.work === "checking";
  const check = button(checking ? "Checking…" : "Check my words", { type: "checkWords" }, "", checking ? " disabled" : "");
  return `<h3>Your words <span class="muted">(mine, ${length} of ${maximumNoteLengths.mine})</span></h3>
<blockquote class="mine">${escapeHtml(model.mine)}</blockquote>
<p>${edit}${check}</p>`;
}

function checkSection(model: OwnItModel): string {
  const intro = `<p class="muted">The check is one read-only Claude call on a copy of the last commit. It sees the entry and your words, never this chat or the explanation page; only an understood check counts.</p>`;
  if (model.work === "checking") {
    return `<h3>Check</h3>\n<p class="muted">Claude is checking your words…</p>`;
  }
  if (!model.lastCheck) {
    return `<h3>Check</h3>\n<p class="muted">Not checked yet.</p>\n${intro}`;
  }
  const check = model.lastCheck;
  const wordsChanged = model.state?.kind === "not checked" ? `<p class="muted">Your words changed after this check; check them again.</p>\n` : "";
  const seconds = Math.round(check.durationMilliseconds / 1000);
  return `<h3>Check</h3>
<p>${verdictBadge(check.verdict)} <span class="muted">${escapeHtml(timeOf(check.checkedAt))} · HEAD ${escapeHtml(shortCommit(check.commit))} · ${seconds} s</span></p>
${wordsChanged}${renderMarkdown(check.feedback)}${whereText(check)}
${intro}`;
}

function chatSection(model: OwnItModel): string {
  const answering = model.work === "answering";
  const hint = chatVerdictCounts ? "Its latest verdict counts, like a check." : "Its verdicts are hints; only a check of your words counts.";
  const lastOwnerMessage = [...model.conversation].reverse().find((turn) => turn.speaker === "owner");
  const useAsMine = lastOwnerMessage ? `<p>${button("Use my last message as mine", { type: "useAsMine" }, "secondary")} <span class="muted">puts it on the clipboard as a mine block and opens the codemap; you paste and save.</span></p>\n` : "";
  return `<h3>Chat <span class="muted">(tutor)</span></h3>
<p class="muted">Ask back, or explain and get told what is missing. ${hint}</p>
${model.conversation.map(chatTurn).join("\n")}
${useAsMine}<textarea id="chat-text" rows="4" placeholder="Your question, or how you think it works">${escapeHtml(model.draft ?? "")}</textarea>
<p><button id="chat-send"${answering ? " disabled" : ""}>${answering ? "Claude is answering…" : "Send"}</button></p>`;
}

function changesSection(model: OwnItModel): string {
  const changes = model.changes;
  if (!changes || (!changes.commitIsGone && changes.commits.length === 0)) {
    return "";
  }
  const showChanges = button("Show changes", { type: "showChanges" }, "secondary");
  if (changes.commitIsGone) {
    return `<h3>Changes since your check</h3>\n<p class="muted">The checked commit ${escapeHtml(shortCommit(changes.checkedCommit))} is gone (the history was rewritten), so what changed cannot be shown. Read the code again and check your words.</p>`;
  }
  const count = `${changes.commits.length} ${changes.commits.length === 1 ? "commit" : "commits"}`;
  return `<h3>Changes since your check <span class="muted">(${count})</span></h3>
<ul class="commits">${changes.commits.map((commit) => `<li><code>${escapeHtml(commit)}</code></li>`).join("")}</ul>
<p>${showChanges}</p>`;
}

// The chat's verdicts are only hints under D1, so they read "would be …".
function chatTurn(turn: EntryChatTurn): string {
  if (turn.speaker === "owner") {
    return `<div class="turn turn-owner"><strong>You</strong>${renderMarkdown(turn.text)}</div>`;
  }
  const verdict = chatVerdictCounts ? verdictBadge(turn.reply.verdict) : `<span class="muted">would be</span> ${verdictBadge(turn.reply.verdict)}`;
  return `<div class="turn turn-claude"><strong>Claude</strong> ${verdict}${renderMarkdown(turn.reply.feedback)}${whereText(turn.reply)}</div>`;
}

function verdictBadge(verdict: EntryChatReply["verdict"]): string {
  return `<span class="verdict verdict-${verdict.replace(" ", "-")}">${escapeHtml(verdict)}</span>`;
}

function whereText(reply: EntryChatReply): string {
  if (!reply.file) {
    return "";
  }
  const where = reply.line ? `${reply.file}:${reply.line}` : reply.file;
  return `<p class="muted">See <code>${escapeHtml(where)}</code></p>`;
}

// 2026-10-09 18:40, in the local time zone.
function timeOf(iso: string): string {
  const date = new Date(iso);
  const twoDigits = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())} ${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
}

// Only real clicks count, so nothing but the owner presses a button. The reply box sends its text
// as it is typed, so a redraw of the panel (after a commit, a check) does not lose it.
const ownItScript = `
(() => {
  const vscode = acquireVsCodeApi();
  const send = (message) => vscode.postMessage(message);
  window.addEventListener("click", (event) => {
    if (!event.isTrusted) {
      return;
    }
    const target = event.target.closest("button");
    if (!target || target.disabled) {
      return;
    }
    if (target.id === "chat-send") {
      const text = document.getElementById("chat-text").value;
      if (text.trim() !== "") {
        send({ type: "chat", text });
      }
      return;
    }
    if (target.dataset.reviewGuide) {
      event.preventDefault();
      send(JSON.parse(target.dataset.reviewGuide));
    }
  }, true);
  document.addEventListener("input", (event) => {
    if (event.target.id === "chat-text") {
      send({ type: "chatDraft", text: event.target.value });
    }
  });
})();
`;

const ownItStyles = `
body { padding: 0 14px 16px; }
main { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); line-height: 1.55; color: var(--vscode-foreground); max-width: 72ch; }
h3 { font-size: 0.85em; margin: 18px 0 4px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground); }
h3 .muted { text-transform: none; letter-spacing: 0; }
blockquote.mine { margin: 4px 0; padding: 2px 10px; border-left: 3px solid var(--vscode-textBlockQuote-border, var(--vscode-descriptionForeground)); white-space: pre-wrap; }
pre.diagram { font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); line-height: 1.35; background: var(--vscode-textCodeBlock-background); padding: 8px 10px; border-radius: 4px; overflow-x: auto; white-space: pre; }
.turn { border-left: 3px solid var(--vscode-descriptionForeground); border-radius: 4px; padding: 6px 10px; margin: 10px 0; background: var(--vscode-editorWidget-background); }
.turn-claude { border-left-color: var(--vscode-textLink-foreground); }
.verdict { display: inline-block; padding: 0 6px; border-radius: 3px; font-weight: 600; font-size: 0.8em; border: 1px solid var(--vscode-descriptionForeground); }
.verdict-understood { border-color: var(--vscode-testing-iconPassed); }
.verdict-almost { border-color: var(--vscode-inputValidation-warningBorder); }
.verdict-not-yet { border-color: var(--vscode-inputValidation-errorBorder); }
textarea { width: 100%; box-sizing: border-box; font-family: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); }
button:disabled { opacity: 0.6; cursor: default; }
ul.commits { padding-left: 18px; margin: 4px 0; }
`;

