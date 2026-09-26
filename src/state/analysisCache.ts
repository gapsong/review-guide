import * as path from "path";
import { DeepCheck } from "../analysis/deepCheck";
import { UnitSorting } from "../analysis/sorting";
import { PullRequest } from "../github/pullRequest";
import { readJsonFile, writeJsonFile } from "./jsonFile";

// Pass 1's answers for one PR. Pass 2's answers are stored the same way, per unit hash. The key is (repo, PR number, head commit, unit hash): repo and PR
// pick the file, the head commit is stored in it, and each unit's answer is found by its hash,
// so a new push re-runs only the units whose change is different.
export interface CachedOverview {
  headSha: string;
  summary: string;
  readingOrder: string[];
  draftProfile?: string;
  sortingsByHash: Record<string, UnitSorting>;
}

export class AnalysisCache {
  constructor(private readonly folder: string) {}

  readOverview(pullRequest: PullRequest): CachedOverview | undefined {
    return readJsonFile<CachedOverview | undefined>(this.fileOf(pullRequest, "overview.json"), undefined);
  }

  writeOverview(pullRequest: PullRequest, overview: CachedOverview): void {
    writeJsonFile(this.fileOf(pullRequest, "overview.json"), overview);
  }

  readDeepCheck(pullRequest: PullRequest, unitHash: string): DeepCheck | undefined {
    return this.readDeepChecks(pullRequest)[unitHash];
  }

  writeDeepCheck(pullRequest: PullRequest, unitHash: string, check: DeepCheck): void {
    const checks = this.readDeepChecks(pullRequest);
    checks[unitHash] = check;
    writeJsonFile(this.fileOf(pullRequest, "deep-checks.json"), checks);
  }

  private readDeepChecks(pullRequest: PullRequest): Record<string, DeepCheck> {
    return readJsonFile<Record<string, DeepCheck>>(this.fileOf(pullRequest, "deep-checks.json"), {});
  }

  private fileOf(pullRequest: PullRequest, name: string): string {
    const { owner, name: repoName } = pullRequest.repo;
    return path.join(this.folder, owner, repoName, String(pullRequest.number), name);
  }
}
