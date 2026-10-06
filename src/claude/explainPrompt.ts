import { CodemapEntry } from "../codemap/codemap";
import { explanationFolderOf } from "../codemap/explanationFiles";

// The interactive Claude Code run that writes an explanation page for one path.
// The prompt text lives in media/explainPrompt.md; this file fills it in.

export interface ExplainRequest {
  path: string;
  kind: "file" | "folder";
  entry: CodemapEntry | undefined;
}

export interface ExplainTerminal {
  name: string;
  // The terminal runs Claude Code itself, not a shell (see DECISIONS.md), so no part of the
  // prompt is ever read as a shell command.
  executable: string;
  args: string[];
}

export function explainTerminal(claudePath: string, template: string, request: ExplainRequest): ExplainTerminal {
  return {
    name: `Explain: ${request.path}`,
    executable: claudePath,
    args: [explainPrompt(template, request)],
  };
}

// Fills every {{name}} of the template in one pass, so a value that itself contains "{{...}}"
// (a file name, the reviewer's sentence) is never filled a second time.
export function explainPrompt(template: string, request: ExplainRequest): string {
  const values = new Map([
    ["path", request.path],
    ["kind", request.kind],
    ["entry", request.entry ? entryText(request.entry) : "none"],
    ["outputFolder", `${explanationFolderOf(request.path)}/`],
  ]);
  return template.replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) => {
    const value = values.get(name);
    if (value === undefined) {
      throw new Error(`media/explainPrompt.md has an unknown placeholder ${placeholder}`);
    }
    return value;
  });
}

// The entry as it stands in the codemap file, so Claude reads it the way the reviewer wrote it.
function entryText(entry: CodemapEntry): string {
  return [`path: ${entry.path}`, `says: ${entry.says}`, `label: ${entry.label}`, `deep: ${entry.deep}`].join("\n");
}
