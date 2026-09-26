// Renders the guide panel. Pure: takes the view model, returns HTML, so it can be tested without VS Code.

import { Tier } from "../analysis/sorting";

export interface GuideModel {
  pullRequestNumber: number;
  file: string;
  title: string;
  lines: string;
  // Missing until pass 1 has sorted the unit.
  tier: Tier | undefined;
  reason: string | undefined;
  worthHaving: string | undefined;
}

export function renderGuide(model: GuideModel | undefined, nonce: string, cspSource: string): string {
  const body = model ? unitSection(model) : `<p class="muted">Click a change in the side bar to see what to check.</p>`;
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

function unitSection(model: GuideModel): string {
  return [
    `<h2>${escapeHtml(model.title)}</h2>`,
    `<p class="muted">${escapeHtml(model.file)} · ${escapeHtml(model.lines)} · PR #${model.pullRequestNumber}</p>`,
    tierSection(model),
  ].join("\n");
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

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const styles = `
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 0 12px 16px; }
h2 { font-size: 1.1em; margin: 12px 0 2px; }
h3 { font-size: 0.95em; margin: 16px 0 4px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground); }
.muted { color: var(--vscode-descriptionForeground); margin-top: 0; }
.tier { display: inline-block; padding: 0 6px; border-radius: 3px; font-weight: 600; text-transform: uppercase; font-size: 0.8em; }
.tier-critical { background: var(--vscode-inputValidation-errorBackground); border: 1px solid var(--vscode-inputValidation-errorBorder); }
.tier-check { background: var(--vscode-inputValidation-warningBackground); border: 1px solid var(--vscode-inputValidation-warningBorder); }
.tier-skim { border: 1px solid var(--vscode-descriptionForeground); }
.worth { border-left: 3px solid var(--vscode-inputValidation-infoBorder); padding-left: 8px; }
`;

const script = `
const vscode = acquireVsCodeApi();
document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-message]");
  if (target) {
    vscode.postMessage(JSON.parse(target.dataset.message));
  }
});
`;
