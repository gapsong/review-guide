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
  // What is missing ("almost") or wrong ("not yet"), or what the explanation got right.
  feedback: string;
  line?: number;
}

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
  explanation?: string;
  lastCheck?: OwnershipCheckResult;
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
  // changed since the reviewer's review goes one step back (understood -> read, read -> unread) and is flagged.
  updateUnits(repo: RepoId, pullRequestNumber: number, units: { unit: ReviewUnit; tier: Tier | undefined }[]): void {
    const state = this.read(repo);
    for (const { unit, tier } of units) {
      const key = recordKey(pullRequestNumber, unit.id);
      const record = state.units[key] ?? newRecord(pullRequestNumber, unit);
      if (record.hash !== unit.hash) {
        record.changedSinceReview = record.state !== "unread";
        record.state = stepBack(record.state);
        record.hash = unit.hash;
      }
      record.tier = tier;
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

  saveOwnershipCheck(repo: RepoId, pullRequestNumber: number, unit: ReviewUnit, explanation: string, result: OwnershipCheckResult): void {
    this.change(repo, pullRequestNumber, unit, (record) => {
      record.explanation = explanation;
      record.lastCheck = result;
      record.changedSinceReview = false;
      if (result.verdict === "understood") {
        record.state = "understood";
      } else if (record.state === "unread") {
        record.state = "read";
      }
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
