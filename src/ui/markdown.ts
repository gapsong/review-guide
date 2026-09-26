// A small Markdown renderer for Claude's answers and the reviewer's chat messages in the guide panel.
// It covers what those texts use: paragraphs, headings, lists, tables, quotes, fenced blocks,
// **bold**, *italic* and `code`. The extension ships without dependencies, so no library.
// Safe by construction: every piece of text is escaped first; only this file adds tags.

type Block =
  | { kind: "fence"; text: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "quote"; lines: string[] }
  | { kind: "paragraph"; lines: string[] };

export function renderMarkdown(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return splitIntoBlocks(lines).map(renderBlock).join("");
}

function splitIntoBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
    } else if (isFenceLine(line)) {
      const end = findClosingFence(lines, i + 1);
      blocks.push({ kind: "fence", text: lines.slice(i + 1, end).join("\n") });
      i = end + 1;
    } else if (headingMatch(line)) {
      const [, hashes, heading] = headingMatch(line)!;
      blocks.push({ kind: "heading", level: hashes.length, text: heading });
      i++;
    } else if (listItemMatch(line)) {
      const end = takeWhile(lines, i, (next) => listItemMatch(next) !== null || isListContinuation(next));
      blocks.push(listBlock(lines.slice(i, end)));
      i = end;
    } else if (isTableStart(lines, i)) {
      const end = takeWhile(lines, i, (next) => next.trim().startsWith("|"));
      blocks.push(tableBlock(lines.slice(i, end)));
      i = end;
    } else if (line.startsWith(">")) {
      const end = takeWhile(lines, i, (next) => next.startsWith(">"));
      blocks.push({ kind: "quote", lines: lines.slice(i, end).map((quoted) => quoted.replace(/^>\s?/, "")) });
      i = end;
    } else {
      const end = takeWhile(lines, i, (next, index) => next.trim() !== "" && !startsAnotherBlock(lines, index));
      blocks.push({ kind: "paragraph", lines: lines.slice(i, end) });
      i = end;
    }
  }
  return blocks;
}

function renderBlock(block: Block): string {
  switch (block.kind) {
    case "fence":
      return `<pre class="diagram">${escapeHtml(block.text)}</pre>`;
    case "heading": {
      // Headings inside an answer sit below the panel's own h2 / h3.
      const level = Math.min(block.level + 3, 6);
      return `<h${level}>${renderInline(block.text)}</h${level}>`;
    }
    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      return `<${tag}>${block.items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${tag}>`;
    }
    case "table": {
      const header = block.header.map((cell) => `<th>${renderInline(cell)}</th>`).join("");
      const rows = block.rows.map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`).join("");
      return `<table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`;
    }
    case "quote":
      return `<blockquote>${renderInline(block.lines.join("\n"))}</blockquote>`;
    case "paragraph":
      return `<p>${renderInline(block.lines.join("\n"))}</p>`;
  }
}

// Code spans are set aside first (as numbered placeholders), so that * inside code stays as it is
// and **bold** may contain `code`; then **bold**, *italic* and line breaks; then the code comes back.
// Underscores are left alone: in code talk they are names like _ste, not emphasis.
export function renderInline(text: string): string {
  const codeSpans: string[] = [];
  const withPlaceholders = text.replaceAll(PLACEHOLDER, "").replace(/`([^`\n]+)`/g, (_, code: string) => {
    codeSpans.push(`<code>${escapeHtml(code)}</code>`);
    return `${PLACEHOLDER}${codeSpans.length - 1}${PLACEHOLDER}`;
  });
  return escapeHtml(withPlaceholders)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?![*\w])/g, "$1<em>$2</em>")
    .replace(/\n/g, "<br>")
    .replace(/\uE000(\d+)\uE000/g, (_, index: string) => codeSpans[Number(index)]);
}

// A character from Unicode's private use area: it has no meaning and does not occur in normal text.
const PLACEHOLDER = "\uE000";

function isFenceLine(line: string): boolean {
  return line.trim().startsWith("```");
}

// An unclosed fence runs to the end of the text, so a diagram is never shown as prose.
function findClosingFence(lines: string[], from: number): number {
  for (let i = from; i < lines.length; i++) {
    if (isFenceLine(lines[i])) {
      return i;
    }
  }
  return lines.length;
}

function headingMatch(line: string): RegExpMatchArray | null {
  return line.match(/^(#{1,6})\s+(.*)$/);
}

function listItemMatch(line: string): RegExpMatchArray | null {
  return line.match(/^\s{0,3}([-*]|\d+[.)])\s+(.*)$/);
}

// An indented line right below a list item continues that item.
function isListContinuation(line: string): boolean {
  return /^\s{2,}\S/.test(line);
}

function listBlock(lines: string[]): Block {
  const ordered = /^\s*\d/.test(lines[0]);
  const items: string[] = [];
  for (const line of lines) {
    const item = listItemMatch(line);
    if (item) {
      items.push(item[2]);
    } else {
      items[items.length - 1] += "\n" + line.trim();
    }
  }
  return { kind: "list", ordered, items };
}

// A table is a | row followed by a | --- | separator row.
function isTableStart(lines: string[], i: number): boolean {
  const next = lines[i + 1] ?? "";
  return lines[i].trim().startsWith("|") && /^\s*\|?\s*:?-{2,}/.test(next);
}

function tableBlock(lines: string[]): Block {
  const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
  const [header, , ...rows] = lines;
  return { kind: "table", header: cells(header), rows: rows.map(cells) };
}

function startsAnotherBlock(lines: string[], i: number): boolean {
  const line = lines[i];
  return isFenceLine(line) || headingMatch(line) !== null || listItemMatch(line) !== null
    || isTableStart(lines, i) || line.startsWith(">");
}

// The block starts at `from`; it runs on while `belongs` holds. Returns the index just past its last line.
function takeWhile(lines: string[], from: number, belongs: (line: string, index: number) => boolean): number {
  let end = from + 1;
  while (end < lines.length && belongs(lines[end], end)) {
    end++;
  }
  return end;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
