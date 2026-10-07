import * as assert from "assert";
import { NoStructuredAnswerError, readClaudeResult } from "../../src/claude/claudeCli";

describe("reading the answer of the Claude Code CLI", () => {
  it("takes the structured answer and adds up the tokens", () => {
    const stdout = JSON.stringify({ subtype: "success", structured_output: { tier: "critical" }, duration_ms: 1200, usage: { input_tokens: 10, cache_read_input_tokens: 5, output_tokens: 7 } });
    assert.deepStrictEqual(readClaudeResult(stdout), { answer: { tier: "critical" }, durationMilliseconds: 1200, inputTokens: 15, outputTokens: 7 });
  });

  it("says what Claude wrote when it answered in plain words instead of JSON", () => {
    const stdout = JSON.stringify({ subtype: "success", result: "I appreciate the request, but I will not do that." });
    assert.throws(() => readClaudeResult(stdout), (error: unknown) =>
      error instanceof NoStructuredAnswerError && error.message === "Claude Code gave no structured answer. It said: I appreciate the request, but I will not do that.");
  });

  it("reports an error run with its kind", () => {
    const stdout = JSON.stringify({ subtype: "error_max_turns", is_error: true, result: "" });
    assert.throws(() => readClaudeResult(stdout), /Claude Code reported an error \(error_max_turns\)/);
  });
});
