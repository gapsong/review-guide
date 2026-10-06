import { badgeOf } from "../codemap/badge";
import { CodemapEntry } from "../codemap/codemap";
import { explanationFolderOf } from "../codemap/explanationFiles";
import { escapeHtml } from "./markdown";

// Renders the Explain panel. Pure: takes what to show, returns HTML, so it can be tested without VS Code.
//
// Without an explanation the panel is a small page of its own: the codemap entry and a
// "Generate explanation" button. With one, Claude's page itself is the panel's document, with the
// header put on top of it: a webview cannot load its own files into an iframe (DECISIONS.md).

export interface ExplainHeader {
  path: string;
  // Missing when the path is not in the codemap yet.
  entry: CodemapEntry | undefined;
  hasExplanation: boolean;
  // The page shown, relative to the explanation folder, when it is not index.html.
  otherPage: string | undefined;
}

export interface ExplanationPage {
  html: string;
  // Webview address of the page's own folder, ending in "/": its relative links, images and
  // scripts resolve against it.
  baseUrl: string;
  // Webview address of the path's explanation folder, ending in "/": links into it open in the panel.
  folderUrl: string;
}

// Messages the panel's buttons and links send back to the extension.
export type ExplainMessage =
  | { type: "generate" }
  | { type: "showIndex" }
  // target: relative to the explanation folder.
  | { type: "openLink"; target: string };

export function renderExplainPanel(header: ExplainHeader, nonce: string, cspSource: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>${headerStyles}</style>
</head>
<body>
${headerHtml(header)}
<script nonce="${nonce}">${panelScript(undefined)}</script>
</body>
</html>`;
}

// The header goes into a shadow root, so the page's styles and the header's styles leave each other alone.
// The panel's script comes first in the head, so it takes the one handle to VS Code before any
// script of the page can.
export function renderExplanationPage(page: ExplanationPage, header: ExplainHeader, cspSource: string): string {
  const bar = `<review-guide-bar><template shadowrootmode="open"><style>${barStyles}</style>${headerHtml(header)}</template></review-guide-bar>`;
  const headStart = `<base href="${escapeHtml(page.baseUrl)}">
<meta http-equiv="Content-Security-Policy" content="${explanationPolicy(cspSource)}">
<script>${panelScript(page.folderUrl)}</script>`;
  const hasBody = bodyTag.test(page.html);
  // Without a <body> tag the browser starts the body at the first visible element, which is then the bar.
  const headText = hasBody ? headStart : headStart + bar;
  const withHead = insertAfterTag(page.html, headTag, headText) ?? insertAfterTag(page.html, htmlTag, headText) ?? headText + page.html;
  return hasBody ? insertAfterTag(withHead, bodyTag, bar)! : withHead;
}

// Claude's pages may use inline scripts and embedded data: images and fonts (the explain-visually
// stepper does). Everything else comes only from the explanations folder, and nothing from the web.
export function explanationPolicy(cspSource: string): string {
  return [
    "default-src 'none'",
    `img-src ${cspSource} data:`,
    `media-src ${cspSource} data:`,
    `font-src ${cspSource} data:`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `script-src ${cspSource} 'unsafe-inline'`,
    `connect-src ${cspSource}`,
    "frame-src 'none'",
  ].join("; ") + ";";
}

function headerHtml(header: ExplainHeader): string {
  const badge = header.entry ? `<span class="badge">${badgeOf(header.entry)}</span>` : "";
  const about = header.entry
    ? `<p class="says">${escapeHtml(header.entry.says)}</p>
<p class="muted">${labelLine(header.entry)}</p>`
    : `<p class="muted">Not in the codemap yet.</p>`;
  return `<header>
<h2>${badge}<span class="path">${escapeHtml(header.path)}</span></h2>
${about}
${actions(header)}
</header>`;
}

function labelLine(entry: CodemapEntry): string {
  return entry.deep ? `${entry.label} · deep module: a small interface that hides much logic` : entry.label;
}

function actions(header: ExplainHeader): string {
  if (!header.hasExplanation) {
    const folder = escapeHtml(`${explanationFolderOf(header.path)}/`);
    return `<p class="muted">No explanation yet. The button starts Claude Code in a terminal, where you see what it does; it writes the page into <code>${folder}</code>.</p>
<p>${button("Generate explanation", { type: "generate" })}</p>`;
  }
  const back = header.otherPage
    ? `${button("Back to index.html", { type: "showIndex" })} <span class="muted">Showing ${escapeHtml(header.otherPage)}</span> `
    : "";
  return `<p>${back}${button("Regenerate", { type: "generate" }, "secondary")}</p>`;
}

function button(label: string, message: ExplainMessage, className = ""): string {
  const classAttribute = className ? ` class="${className}"` : "";
  return `<button${classAttribute} data-review-guide="${escapeHtml(JSON.stringify(message))}">${escapeHtml(label)}</button>`;
}

// Inserts text right after the first tag that matches; undefined when the page has no such tag.
function insertAfterTag(html: string, tag: RegExp, text: string): string | undefined {
  const match = tag.exec(html);
  if (!match) {
    return undefined;
  }
  const end = match.index + match[0].length;
  return html.slice(0, end) + text + html.slice(end);
}

const htmlTag = /<html(\s[^>]*)?>/i;
const headTag = /<head(\s[^>]*)?>/i;
const bodyTag = /<body(\s[^>]*)?>/i;

// In a <script>, "</script>" inside a string would end the script early; < is the same "<" to JavaScript.
function scriptValue(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

// Clicks are caught before VS Code's own link handling, which would send a link to a local file to
// the web browser. Only real clicks count, so a script of the page cannot press the buttons.
function panelScript(folderUrl: string | undefined): string {
  return `
(() => {
  const vscode = acquireVsCodeApi();
  const folderUrl = ${scriptValue(folderUrl ?? null)};
  window.addEventListener("click", (event) => {
    if (!event.isTrusted) {
      return;
    }
    for (const node of event.composedPath()) {
      if (node.dataset && node.dataset.reviewGuide) {
        event.preventDefault();
        event.stopPropagation();
        vscode.postMessage(JSON.parse(node.dataset.reviewGuide));
        return;
      }
      if (node.tagName === "A" && node.href) {
        openLink(event, node);
        return;
      }
    }
  }, true);

  // An anchor (#part) is scrolled to by VS Code; a web link is opened in the browser by VS Code.
  function openLink(event, link) {
    const href = link.getAttribute("href") || "";
    if (!folderUrl || href.startsWith("#")) {
      return;
    }
    const target = new URL(link.href);
    const folder = new URL(folderUrl);
    if (target.origin !== folder.origin) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (target.pathname.startsWith(folder.pathname)) {
      vscode.postMessage({ type: "openLink", target: decodeURIComponent(target.pathname.slice(folder.pathname.length)) });
    }
  }
})();
`;
}

const headerStyles = `
header { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); line-height: 1.55; color: var(--vscode-foreground); max-width: 72ch; }
h2 { font-size: 1.15em; font-weight: 600; margin: 14px 0 4px; }
.badge { margin-right: 8px; }
.path { font-family: var(--vscode-editor-font-family); }
p { margin: 6px 0; }
.says { font-size: 1.05em; }
.muted { color: var(--vscode-descriptionForeground); }
code { font-family: var(--vscode-editor-font-family); font-size: 0.92em; background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; }
button { font-family: inherit; font-size: inherit; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 2px; padding: 4px 10px; margin-right: 6px; cursor: pointer; }
button:hover { background: var(--vscode-button-hoverBackground); }
button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
`;

// The bar brings its own background: Claude's page may be light while VS Code is dark.
const barStyles = `
:host { all: initial; display: block; margin: 8px 0 16px; padding: 4px 14px 8px; border-radius: 6px; background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border, var(--vscode-descriptionForeground)); }
${headerStyles}
h2 { margin-top: 8px; }
`;
