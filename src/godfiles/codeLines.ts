import { Language } from "./sourceFiles";

// Code lines: lines that are not blank and not only a comment. Cheap rules per language family;
// they are shown and decide the candidate threshold, but they never enter the score.

export function countCodeLines(text: string, language: Language): number {
  const lines = text.split(/\r?\n/);
  return language === "python" ? countHashCommentedLines(lines) : countSlashCommentedLines(lines);
}

function countHashCommentedLines(lines: string[]): number {
  return lines.filter((line) => {
    const trimmed = line.trim();
    return trimmed !== "" && !trimmed.startsWith("#");
  }).length;
}

// "//" line comments and "/* */" blocks, as in the C family, JavaScript, Go, Rust, Java and most others.
// A block comment opened after code on the same line is not followed: "**/*.ts" in a string would
// look like one, and a wrong guess there would hide every line below it.
function countSlashCommentedLines(lines: string[]): number {
  let insideBlockComment = false;
  let codeLines = 0;
  for (const line of lines) {
    const { hasCode, endsInsideBlockComment } = readLine(line.trim(), insideBlockComment);
    insideBlockComment = endsInsideBlockComment;
    if (hasCode) {
      codeLines++;
    }
  }
  return codeLines;
}

function readLine(line: string, startsInsideBlockComment: boolean): { hasCode: boolean; endsInsideBlockComment: boolean } {
  let rest = line;
  let insideBlockComment = startsInsideBlockComment;
  let hasCode = false;
  while (rest !== "") {
    if (insideBlockComment) {
      const end = rest.indexOf("*/");
      if (end === -1) {
        return { hasCode, endsInsideBlockComment: true };
      }
      rest = rest.slice(end + 2).trim();
      insideBlockComment = false;
    } else if (rest.startsWith("//")) {
      break;
    } else if (rest.startsWith("/*")) {
      insideBlockComment = true;
      rest = rest.slice(2);
    } else {
      hasCode = true;
      break;
    }
  }
  return { hasCode, endsInsideBlockComment: insideBlockComment };
}
