import { spawn } from "child_process";

export interface ClaudeSettings {
  // Path of the `claude` executable (Claude Code CLI).
  executable: string;
  model: string;
}

export interface ClaudeRequest {
  prompt: string;
  // JSON schema the answer must follow.
  schema: object;
  // Claude runs here: the PR worktree.
  workingDirectory: string;
  // Further folders Claude may read, like the context folder with git history.
  readableFolders: string[];
}

export interface ClaudeRun<T> {
  answer: T;
  durationMilliseconds: number;
  inputTokens: number;
  outputTokens: number;
}

export type RunClaude = <T>(request: ClaudeRequest) => Promise<ClaudeRun<T>>;

const readOnlyTools = "Read,Grep,Glob";
const deniedTools = "Bash,Edit,Write,NotebookEdit,WebSearch,WebFetch,Task,Agent";
const timeoutMilliseconds = 20 * 60 * 1000;

// The read-only call from the spec, plus the hardening flags explained in DECISIONS.md.
// The prompt is not an argument: it goes in on stdin, because the tool lists would swallow it.
export function claudeArguments(model: string, schema: object, readableFolders: string[]): string[] {
  const args = [
    "-p",
    "--model", model,
    "--permission-mode", "dontAsk",
    "--restricted",
    "--tools", readOnlyTools,
    "--allowedTools", readOnlyTools,
    "--disallowedTools", deniedTools,
    "--strict-mcp-config",
    "--no-session-persistence",
    "--json-schema", JSON.stringify(schema),
    "--output-format", "json",
  ];
  for (const folder of readableFolders) {
    args.push("--add-dir", folder);
  }
  return args;
}

export function claudeRunner(settings: () => ClaudeSettings): RunClaude {
  return async <T>(request: ClaudeRequest): Promise<ClaudeRun<T>> => {
    const { executable, model } = settings();
    const args = claudeArguments(model, request.schema, request.readableFolders);
    const stdout = await runProcess(executable, args, request.workingDirectory, request.prompt);
    return readClaudeResult<T>(stdout);
  };
}

function runProcess(executable: string, args: string[], cwd: string, input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => child.kill(), timeoutMilliseconds);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Could not start Claude Code (${executable}): ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const output = Buffer.concat(stdout).toString("utf8");
      if (code !== 0 && output.trim() === "") {
        reject(new Error(`Claude Code stopped with exit code ${code}: ${Buffer.concat(stderr).toString("utf8").trim()}`));
      } else {
        resolve(output);
      }
    });
    child.stdin.end(input);
  });
}

interface CliResult {
  is_error?: boolean;
  subtype?: string;
  result?: string;
  structured_output?: unknown;
  duration_ms?: number;
  usage?: {
    input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens?: number;
  };
}

export function readClaudeResult<T>(stdout: string): ClaudeRun<T> {
  const result = JSON.parse(stdout) as CliResult;
  if (result.is_error || result.subtype !== "success") {
    throw new Error(`Claude Code reported an error (${result.subtype ?? "unknown"}): ${result.result ?? ""}`);
  }
  const answer = result.structured_output ?? JSON.parse(result.result ?? "null");
  if (answer === null || typeof answer !== "object") {
    throw new Error("Claude Code gave no structured answer");
  }
  const usage = result.usage ?? {};
  return {
    answer: answer as T,
    durationMilliseconds: result.duration_ms ?? 0,
    inputTokens: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
    outputTokens: usage.output_tokens ?? 0,
  };
}
