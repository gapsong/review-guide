import * as fs from "fs";
import * as path from "path";
import { claudeRunner } from "../../src/claude/claudeCli";
import { PullRequestCheckouts } from "../../src/git/pullRequestCheckout";
import { ReviewGuide } from "../../src/reviewGuide";
import { AnalysisCache } from "../../src/state/analysisCache";
import { ReviewStateStore } from "../../src/state/reviewState";
import { readPythonSymbols } from "./pythonSymbols";

export const fakeClaudePath = path.resolve(__dirname, "..", "..", "..", "test", "fixtures", "fake-claude.js");

export interface FakeClaudeCall {
  pass: string;
  unitIds: string[];
  cwd: string;
  // The folders given with --add-dir.
  readableFolders: string[];
  // Whether the prompt contained FAKE_CLAUDE_WATCH, when it is set.
  saw?: boolean;
}

// Points the fake `claude` at a fresh log and the given tier rules (see test/fixtures/fake-claude.js).
export function useFakeClaude(scratch: string, tiers: Record<string, string>): { calls: () => FakeClaudeCall[] } {
  const logPath = path.join(scratch, "fake-claude.log");
  process.env.FAKE_CLAUDE_LOG = logPath;
  process.env.FAKE_CLAUDE_TIERS = JSON.stringify(tiers);
  delete process.env.FAKE_CLAUDE_QUESTION_LINES;
  delete process.env.FAKE_CLAUDE_NO_QUESTIONS;
  delete process.env.FAKE_CLAUDE_OMIT;
  delete process.env.FAKE_CLAUDE_NO_QUESTIONS_FOR;
  delete process.env.FAKE_CLAUDE_FAIL_SINGLE;
  return {
    calls: () =>
      fs.existsSync(logPath)
        ? fs.readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as FakeClaudeCall)
        : [],
  };
}

// The core, wired like the extension does it, but with Python symbols read by the test and the fake `claude`.
export function testReviewGuide(
  storagePath: string,
  confirmDeepCheck: (criticalUnitCount: number) => Promise<boolean> = async () => true,
): ReviewGuide {
  return new ReviewGuide({
    state: new ReviewStateStore(path.join(storagePath, "state")),
    confirmDeepCheck,
    checkouts: new PullRequestCheckouts(storagePath, async () => ({})),
    readSymbols: readPythonSymbols,
    cache: new AnalysisCache(path.join(storagePath, "cache")),
    runClaude: claudeRunner(() => ({ executable: fakeClaudePath, model: "claude-opus-5-5" })),
  });
}
