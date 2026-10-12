import { createHash } from "crypto";
import { Verdict } from "../state/reviewState";
import { labelEmoji } from "./badge";
import { CodemapEntry, CodemapLabel } from "./codemap";

// Does the owner own a codemap entry? Pure: the state is derived from the entry, the stored check
// of the owner's words (`mine`) and how many commits touched the path since that check, so it can
// be tested without VS Code or git.
//
//   no words ── owner writes mine ──► not checked ── Check my words (1 read-only call) ──┐
//      ▲                                  ▲                                                 │
//      │                                  └──── mine changed (its hash differs) ────────────┤
//      │                                                                                    ▼
//      │                                                   not yet · almost · understood = owned ✅
//      │                                                                                    │
//      │                                         a commit touches the path after the check  ▼
//      └───────────────────────────────────────────────────────────────── changed (not owned)
//
// Only a check of mine counts (D1 in DECISIONS.md): the chat is a tutor and its verdicts are hints.

// D1, the one switch: false = only "Check my words" decides the state, and a chat verdict is shown
// as "would be …"; true = the chat's latest verdict counts as a check too, as for PR units (F15).
export const chatVerdictCounts = false;

export interface EntryCheck {
  verdict: Verdict;
  // What is missing (asked as a question) or wrong, in the explanation language.
  feedback: string;
  // For "not yet": where the mistake is, as a repo path and line.
  file?: string;
  line?: number;
  // The HEAD the check read; "commits since the check" count from here.
  commit: string;
  // The hash of the words that were checked; other words are not checked.
  mineHash: string;
  // ISO time.
  checkedAt: string;
  durationMilliseconds: number;
}

export interface EntryChatReply {
  verdict: Verdict;
  feedback: string;
  file?: string;
  line?: number;
}

export type EntryChatTurn =
  | { speaker: "owner"; text: string }
  | { speaker: "claude"; reply: EntryChatReply };

// What the extension keeps about one entry. It stays when the entry leaves the codemap, so the
// owner's chat is not lost when an entry is renamed and put back.
export interface EntryRecord {
  check?: EntryCheck;
  conversation: EntryChatTurn[];
}

// How many commits touched the path after the checked commit; "gone" when that commit no longer
// exists (the history was rewritten), so the number cannot be known.
export type CommitsSinceCheck = number | "gone";

export type OwnershipState =
  | { kind: "no words" }
  | { kind: "not checked" }
  | { kind: "not yet" | "almost" | "owned" | "changed"; check: EntryCheck; commitsSince: CommitsSinceCheck };

export function ownershipStateOf(entry: CodemapEntry, record: EntryRecord | undefined, commitsSince: CommitsSinceCheck | undefined): OwnershipState {
  if (entry.mine === undefined) {
    return { kind: "no words" };
  }
  const check = record?.check;
  if (!check || check.mineHash !== hashOfMine(entry.mine)) {
    return { kind: "not checked" };
  }
  const since = commitsSince ?? 0;
  if (check.verdict !== "understood") {
    return { kind: check.verdict, check, commitsSince: since };
  }
  return { kind: since === 0 ? "owned" : "changed", check, commitsSince: since };
}

export function isOwned(state: OwnershipState): boolean {
  return state.kind === "owned";
}

export function hashOfMine(mine: string): string {
  return createHash("sha256").update(mine.trim()).digest("hex");
}

// The 3am check of a codemap: of the entries where a quiet bug hurts most, how many does the owner
// own, and which one is next.
export interface ThreeAmCheck {
  labels: CodemapLabel[];
  total: number;
  owned: number;
  changed: number;
  almost: number;
  notYet: number;
  // Without words, or with words that are not checked yet.
  notChecked: number;
  next: CodemapEntry | undefined;
}

export const threeAmLabels: CodemapLabel[] = ["money", "security"];

export function threeAmCheck(entries: CodemapEntry[], stateOf: (entry: CodemapEntry) => OwnershipState, labels: CodemapLabel[] = threeAmLabels): ThreeAmCheck {
  const counted = entries.filter((entry) => labels.includes(entry.label));
  const kinds = counted.map((entry) => stateOf(entry).kind);
  const count = (...wanted: OwnershipState["kind"][]) => kinds.filter((kind) => wanted.includes(kind)).length;
  return {
    labels,
    total: counted.length,
    owned: count("owned"),
    changed: count("changed"),
    almost: count("almost"),
    notYet: count("not yet"),
    notChecked: count("no words", "not checked"),
    next: nextToOwn(entries, stateOf, labels),
  };
}

// "3am 💰🔒: 2 of 9 owned · 1 changed · 2 almost · 4 not checked · next: dispatcher.py"
export function describeThreeAmCheck(check: ThreeAmCheck): string | undefined {
  if (check.total === 0) {
    return undefined;
  }
  const emoji = check.labels.map((label) => labelEmoji[label]).join("");
  const parts = [`3am ${emoji}: ${check.owned} of ${check.total} owned`];
  const others: [number, string][] = [[check.changed, "changed"], [check.almost, "almost"], [check.notYet, "not yet"], [check.notChecked, "not checked"]];
  for (const [number, name] of others) {
    if (number > 0) {
      parts.push(`${number} ${name}`);
    }
  }
  if (check.next) {
    parts.push(`next: ${check.next.path.split("/").pop()}`);
  }
  return parts.join(" · ");
}

// The first entry that is not owned, in codemap order: money before security, then whatever the
// order lists after them.
export function nextToOwn(entries: CodemapEntry[], stateOf: (entry: CodemapEntry) => OwnershipState, labels: CodemapLabel[]): CodemapEntry | undefined {
  for (const label of labels) {
    const next = entries.find((entry) => entry.label === label && !isOwned(stateOf(entry)));
    if (next) {
      return next;
    }
  }
  return undefined;
}

// "Own Next": money, then security, then deep modules, then anything else not owned yet.
export function nextToOwnOfAll(entries: CodemapEntry[], stateOf: (entry: CodemapEntry) => OwnershipState): CodemapEntry | undefined {
  return nextToOwn(entries, stateOf, threeAmLabels)
    ?? entries.find((entry) => entry.deep && !isOwned(stateOf(entry)))
    ?? entries.find((entry) => !isOwned(stateOf(entry)));
}
