import { godFileRules, GodFileItem } from "../godfiles/godFiles";

// "Judge with Claude": one read-only pass about one file of the God Files view. It runs in a copy
// of the repo at HEAD and gets no shell and no git, so the prompt carries the measured numbers and
// the file's commit subjects. language: setting reviewGuide.explanationLanguage.
export function godFileJudgePrompt(item: GodFileItem, context: { commit: string; commitSubjects: string; language: string }): string {
  return `Review Guide pass: god file judge

The owner of this repo wants to know where owning it hurts most. Their rule: "A big file is fine only as a well-designed deep module." A long file with a small interface (1 to ${godFileRules.broadAboveNamesUsedOutside} names used by other files) and one reason to change is a deep module, and that is good. A file is a problem when it does several unrelated jobs behind a broad interface, so it changes for many reasons.

Your working directory is a copy of the repo at commit ${context.commit}. Judge the file below by reading it and what it calls (you have read-only tools; there is no shell and no git). The extension measured it for you; its numbers and commit subjects are at the end.

Answer with:
- verdict: god_file (several unrelated responsibilities behind a broad interface), deep_module (small interface, much hidden logic, one reason to change), hub (broad on purpose with little logic of its own: an index, a table of routes, the shared types callers must build), or ok; verdictWhy in one sentence, by the owner's rule.
- responsibilities: the distinct reasons to change, each with the line range it lives in.
- readingPath: 3 to 5 functions of the file in the order to read them, each with its line and why it comes at that point.
- keepOrSplit: "keep whole" with why; or, only for a god_file, "split" with a split that changes no behaviour: the new modules, what moves into each and the new interface.

Lines are lines of the file at commit ${context.commit}, counting from 1. Write every text in ${context.language}.

## The file
path: ${item.path}
code lines: ${item.codeLines}
names used by other files: ${namesUsedOutside(item)}
commits in ${godFileRules.days} days: ${item.commits}
other areas it changed with (commits of more than ${godFileRules.largestCoChangeCommitFiles} files left out): ${item.coChangeAreas.join(", ") || "none"}
other areas it imports from: ${item.knownAreas.join(", ") || "none"}
files that import it: ${item.importedBy.length}

## Its commits of the last ${godFileRules.days} days, newest first
${context.commitSubjects}`;
}

// As the language server found them; "not measured" when it could not.
function namesUsedOutside(item: GodFileItem): string {
  const { breadth } = item;
  if (breadth.state !== "known") {
    return breadth.state === "unknown" ? `not measured (${breadth.reason})` : "not measured yet";
  }
  const more = breadth.complete ? "" : `, and the count stopped there (more than ${godFileRules.broadAboveNamesUsedOutside})`;
  return `${breadth.names.length}${more}: ${breadth.names.join(", ") || "none"}`;
}
