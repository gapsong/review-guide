// Renders the guide panel. Pure: takes the view model, returns HTML, so it can be tested without VS Code.

export interface GuideModel {
  pullRequestNumber: number;
  file: string;
  title: string;
  lines: string;
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
  return `<h2>${escapeHtml(model.title)}</h2>
<p class="muted">${escapeHtml(model.file)} · ${escapeHtml(model.lines)} · PR #${model.pullRequestNumber}</p>`;
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
