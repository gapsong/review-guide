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

export interface ExplainSettings {
  claudePath: string;
  // The language the page is written in (setting reviewGuide.explanationLanguage).
  language: string;
}

export function explainTerminal(settings: ExplainSettings, template: string, request: ExplainRequest): ExplainTerminal {
  return {
    name: `Explain: ${request.path}`,
    executable: settings.claudePath,
    args: [explainPrompt(template, request, settings.language)],
  };
}

export const defaultExplanationLanguage = "English";

// Fills every {{name}} of the template in one pass, so a value that itself contains "{{...}}"
// (a file name, the owner's sentence) is never filled a second time.
export function explainPrompt(template: string, request: ExplainRequest, language: string): string {
  const values = new Map([
    ["path", request.path],
    ["kind", request.kind],
    ["entry", request.entry ? entryText(request.entry) : "none"],
    ["outputFolder", `${explanationFolderOf(request.path)}/`],
    ["language", language.trim() || defaultExplanationLanguage],
  ]);
  return template.replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) => {
    const value = values.get(name);
    if (value === undefined) {
      throw new Error(`media/explainPrompt.md has an unknown placeholder ${placeholder}`);
    }
    return value;
  });
}

// The entry as it stands in the codemap file, so Claude reads it the way the owner wrote it.
function entryText(entry: CodemapEntry): string {
  return [`path: ${entry.path}`, `says: ${entry.says}`, `label: ${entry.label}`, `deep: ${entry.deep}`].join("\n");
}
