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
