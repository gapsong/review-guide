import { godFileRules, GodFileItem } from "../godfiles/godFiles";

// "Judge with Claude": one read-only pass about one file of the God Files view. It runs in a copy
// of the repo at HEAD and gets no shell and no git, so the extension hands over the commit
// subjects and the measured numbers as files in the context folder.

export const ownersRuleForClaude = "A big file is fine only as a well-designed deep module.";

export interface GodFileJudgeContext {
  // The commit the repo copy holds.
  commit: string;
  // Holds history.txt (commit subjects) and numbers.txt (the measurement).
  contextFolder: string;
  // The language the answer is written in (setting reviewGuide.explanationLanguage).
  language: string;
}

export function godFileJudgePrompt(item: GodFileItem, context: GodFileJudgeContext): string {
  return `Review Guide pass: god file judge

The owner of this repo wants to know where owning it hurts most. Their rule: "${ownersRuleForClaude}" A long file with a small interface (1 to ${godFileRules.broadAboveNamesUsedOutside} names used by other files) and one reason to change is a deep module, and that is good. A file is a problem when it does several unrelated jobs behind a broad interface, so it changes for many reasons.

Your working directory is a copy of the repo at commit ${context.commit}. Judge the file below by reading it and what it calls (you have read-only tools; there is no shell and no git). The extension measured it for you:
- ${context.contextFolder}/numbers.txt: its numbers (names other files use, the files that use them, commits, files and areas it changed with).
- ${context.contextFolder}/history.txt: the subjects of the commits of the last ${godFileRules.days} days that touched it, newest first.

Answer with:
- verdict: god_file (several unrelated responsibilities behind a broad interface), deep_module (small interface, much hidden logic, one reason to change), hub (broad on purpose with little logic of its own: an index, a table of routes, the shared types callers must build), or ok (none of these is a problem here); verdictWhy in one sentence, by the owner's rule.
- responsibilities: the distinct reasons to change, each with the line range of the file it lives in and its main functions.
- reasonsToChange: the commit subjects of history.txt grouped into 3 to 6 themes, with the number of commits of each (fewer themes only when there are fewer commits).
- namesUsedOutside: which of the names other files use are justified (verbs of the domain, data types callers must build) and which are not (helpers in the wrong module, tests reaching into internals, data of another concern), each with one sentence why.
- readingPath: 3 to 5 functions of the file in the order to read them, each with its line and why it comes at that point.
- keepOrSplit: "keep whole" with why, and no modules; or, only when the verdict is god_file, "split": a split that changes no behaviour, with the new modules, what moves into each and the new interface.

Lines are lines of the file at commit ${context.commit}, counting from 1. Write every text in ${context.language}.

## The file
path: ${item.path}
code lines: ${item.codeLines}`;
}

// numbers.txt: the measurement, in plain words.
export function numbersText(item: GodFileItem): string {
  const breadth = item.namesUsedOutside === undefined || item.filesUsingIt === undefined
    ? "names used by other files: not measured for this language"
    : `names used by other files (${item.namesUsedOutside.length}): ${item.namesUsedOutside.join(", ") || "none"}\nfiles that use them (${item.filesUsingIt.length}): ${item.filesUsingIt.join(", ") || "none"}`;
  return `# Measured by Review Guide at HEAD (no Claude involved)
path: ${item.path}
code lines: ${item.codeLines}
${breadth}
commits in ${godFileRules.days} days: ${item.commits}
areas it changed with (${item.coChangeAreas.length}, commits of more than ${godFileRules.largestCoChangeCommitFiles} files left out): ${item.coChangeAreas.join(", ") || "none"}
`;
}
