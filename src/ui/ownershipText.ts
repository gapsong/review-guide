import { CommitsSinceCheck, OwnershipState } from "../codemap/entryOwnership";
import { dateOf } from "./dates";

// How the state of an entry reads in the tooltip, the CodeLens and the Explain panel. Pure.
//   "almost · checked 2026-10-09 at e546328, 2 commits since"
//   "✅ owned · checked 2026-10-10 at a1b2c3d"
//   "changed since your check (2 commits) · understood 2026-10-09 at e546328"
export function ownershipLine(state: OwnershipState): string {
  switch (state.kind) {
    case "no words":
      return "no words yet: write mine in the codemap, then Check my words";
    case "not checked":
      return "your words are not checked yet";
    case "owned":
      return `✅ owned · checked ${checkedAt(state.check)}`;
    case "changed":
      return `changed since your check (${commitsText(state.commitsSince)}) · understood ${checkedAt(state.check)}`;
    case "almost":
    case "not yet":
      return `${state.kind} · checked ${checkedAt(state.check)}${sinceText(state.commitsSince)}`;
  }
}

// The CodeLens names the next step, or the date the entry was owned.
export function ownershipLensTitle(state: OwnershipState): string {
  switch (state.kind) {
    case "owned":
      return `✅ owned ${dateOf(new Date(state.check.checkedAt))}`;
    case "changed":
      return "🎯 Check your words again";
    default:
      return "🎯 Own it";
  }
}

export function shortCommit(commit: string): string {
  return commit.slice(0, 7);
}

function checkedAt(check: { checkedAt: string; commit: string }): string {
  return `${dateOf(new Date(check.checkedAt))} at ${shortCommit(check.commit)}`;
}

function commitsText(commitsSince: CommitsSinceCheck): string {
  if (commitsSince === "gone") {
    return "the checked commit is gone";
  }
  return `${commitsSince} ${commitsSince === 1 ? "commit" : "commits"}`;
}

function sinceText(commitsSince: CommitsSinceCheck): string {
  if (commitsSince === 0) {
    return "";
  }
  return commitsSince === "gone" ? ", the checked commit is gone" : `, ${commitsText(commitsSince)} since`;
}
