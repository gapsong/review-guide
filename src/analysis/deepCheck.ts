import { LineRange } from "../review/reviewUnit";

// Pass 2's answer for one critical unit.
export interface DeepCheck {
  // What the code does, in 2-3 plain sentences, so the reviewer understands it before judging it.
  plainWords: string;
  // Only problems the reviewer would block the merge for.
  blockingProblems: BlockingProblem[];
  // "Check: ..." questions for the reviewer, each tied to lines of the new code.
  questions: Question[];
  // What Claude checked itself, and where it looked.
  checked: Evidence[];
  onlyYouCanCheck: string[];
  // Anything Claude could not confirm.
  unconfirmed: string[];
  // The unit's first line when Claude checked it. The cache finds the check by the unit's hash,
  // which ignores line numbers, so a push above the unit moves its lines by the difference.
  anchorLine: number;
}

// The check with its line numbers moved to where the unit is now.
export function movedToUnit(check: DeepCheck, file: string, unitStartLine: number): DeepCheck {
  const shift = unitStartLine - check.anchorLine;
  if (shift === 0) {
    return check;
  }
  return {
    ...check,
    anchorLine: unitStartLine,
    questions: check.questions.map((question) =>
      question.file === file ? { ...question, lines: { start: question.lines.start + shift, end: question.lines.end + shift } } : question),
    blockingProblems: check.blockingProblems.map((problem) =>
      problem.file === file ? { ...problem, line: problem.line + shift } : problem),
  };
}

export interface BlockingProblem {
  file: string;
  line: number;
  why: string;
  howToShowFailure: string;
}

export interface Question {
  text: string;
  file: string;
  lines: LineRange;
  // True when Claude gave no question and the extension asked the default one.
  isDefault: boolean;
}

export interface Evidence {
  what: string;
  where: string;
}
