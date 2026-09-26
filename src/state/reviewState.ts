import * as path from "path";
import { Tier } from "../analysis/sorting";
import { RepoId } from "../github/pullRequest";
import { ReviewUnit } from "../review/reviewUnit";
import { readJsonFile, writeJsonFile } from "./jsonFile";

// Reading a unit does not prove understanding it: "understood" needs Claude to confirm the reviewer's
// own explanation (see the ownership check).
export type ReadState = "unread" | "read" | "understood";

export type Verdict = "understood" | "almost" | "not yet";

export interface OwnershipCheckResult {
  verdict: Verdict;
  // Claude's reply: what is missing ("almost") or wrong ("not yet"), what the explanation got
  // right, and an answer to the reviewer's question. May hold fenced ASCII diagrams.
  feedback: string;
  line?: number;
}

// One message of the ownership chat about a unit.
export type ChatTurn =
  | { speaker: "reviewer"; text: string }
  | { speaker: "claude"; result: OwnershipCheckResult };

// the reviewer's state of one unit of one PR. Stored locally and never sent anywhere except to his local Claude.
export interface UnitRecord {
  pullRequestNumber: number;
  unitId: string;
  file: string;
  // The unit's hash when the state was last set; a different hash means the code changed.
  hash: string;
  tier: Tier | undefined;
  state: ReadState;
  changedSinceReview: boolean;
  // the reviewer's first explanation: until there is one, Claude's own summary stays hidden.
  explanation?: string;
  lastCheck?: OwnershipCheckResult;
  conversation?: ChatTurn[];
}

interface RepoState {
  units: Record<string, UnitRecord>;
}

// Read marks, explanations and check results, one JSON file per repo.
export class ReviewStateStore {
  constructor(private readonly folder: string) {}

  recordOf(repo: RepoId, pullRequestNumber: number, unitId: string): UnitRecord | undefined {
    return this.read(repo).units[recordKey(pullRequestNumber, unitId)];
  }

  recordsOfRepo(repo: RepoId): UnitRecord[] {
    return Object.values(this.read(repo).units);
  }

  // Brings the stored state up to date with the units of a (re)opened PR. A unit whose code
  // changed since the reviewer's review goes one step back (understood -> read, read -> unread) and is
  // flagged. A unit that is no longer in the PR (after a force-push) is dropped, so the ownership
  // overview does not count it. An unknown tier (pass 1 failed) keeps the one stored before.
  updateUnits(repo: RepoId, pullRequestNumber: number, units: { unit: ReviewUnit; tier: Tier | undefined }[]): void {
    const state = this.read(repo);
    const current = new Set(units.map(({ unit }) => recordKey(pullRequestNumber, unit.id)));
    for (const [key, record] of Object.entries(state.units)) {
      if (record.pullRequestNumber === pullRequestNumber && !current.has(key)) {
        delete state.units[key];
      }
    }
    for (const { unit, tier } of units) {
      const key = recordKey(pullRequestNumber, unit.id);
      const record = state.units[key] ?? newRecord(pullRequestNumber, unit);
      if (record.hash !== unit.hash) {
        record.changedSinceReview = record.state !== "unread";
        record.state = stepBack(record.state);
        record.hash = unit.hash;
      }
      record.tier = tier ?? record.tier;
      state.units[key] = record;
    }
    this.write(repo, state);
  }

  setReadState(repo: RepoId, pullRequestNumber: number, unit: ReviewUnit, readState: "unread" | "read"): void {
    this.change(repo, pullRequestNumber, unit, (record) => {
      record.state = readState;
      record.changedSinceReview = false;
    });
  }

  // Adds one exchange of the ownership chat: The reviewer's message and Claude's reply.
  saveOwnershipTurn(repo: RepoId, pullRequestNumber: number, unit: ReviewUnit, message: string, result: OwnershipCheckResult): void {
    this.change(repo, pullRequestNumber, unit, (record) => {
      record.explanation ??= message;
      record.conversation = [...(record.conversation ?? []), { speaker: "reviewer", text: message }, { speaker: "claude", result }];
      record.lastCheck = result;
      record.changedSinceReview = false;
      // The latest verdict counts: a wrong answer after an understood one takes it away again.
      record.state = result.verdict === "understood" ? "understood" : "read";
    });
  }

  private change(repo: RepoId, pullRequestNumber: number, unit: ReviewUnit, update: (record: UnitRecord) => void): void {
    const state = this.read(repo);
    const key = recordKey(pullRequestNumber, unit.id);
    const record = state.units[key] ?? newRecord(pullRequestNumber, unit);
    update(record);
    state.units[key] = record;
    this.write(repo, state);
  }

  private read(repo: RepoId): RepoState {
    return readJsonFile<RepoState>(this.fileOf(repo), { units: {} });
  }

  private write(repo: RepoId, state: RepoState): void {
    writeJsonFile(this.fileOf(repo), state);
  }

  private fileOf(repo: RepoId): string {
    return path.join(this.folder, repo.owner, `${repo.name}.json`);
  }
}

function recordKey(pullRequestNumber: number, unitId: string): string {
  return `${pullRequestNumber}:${unitId}`;
}

function newRecord(pullRequestNumber: number, unit: ReviewUnit): UnitRecord {
  return {
    pullRequestNumber,
    unitId: unit.id,
    file: unit.file,
    hash: unit.hash,
    tier: undefined,
    state: "unread",
    changedSinceReview: false,
  };
}

function stepBack(state: ReadState): ReadState {
  return state === "understood" ? "read" : "unread";
}
