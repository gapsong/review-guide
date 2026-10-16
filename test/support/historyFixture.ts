import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

// A repo whose commits carry chosen dates, for the God Files tests: the history window counts back
// from HEAD's commit time, so the numbers do not depend on the day the tests run.

export const daySeconds = 24 * 60 * 60;
// Some fixed moment; every fixture commit is this many days before it or after it.
export const fixtureNowSeconds = 1_790_000_000;

export function gitAt(repo: string, dateSeconds: number, ...args: string[]): string {
  const date = `@${dateSeconds} +0000`;
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com",
      GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date,
    },
  }).trim();
}

export function initRepo(repo: string): void {
  fs.mkdirSync(repo, { recursive: true });
  gitAt(repo, fixtureNowSeconds, "init", "--quiet", "--initial-branch=main");
}

// Writes the files (null deletes one) and commits them, daysBeforeNow days before the fixed moment.
export function commitFilesAt(repo: string, daysBeforeNow: number, files: Record<string, string | null>, message = "Change"): void {
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(repo, filePath);
    if (content === null) {
      fs.rmSync(fullPath, { force: true });
    } else {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
    }
  }
  const when = fixtureNowSeconds - Math.round(daysBeforeNow * daySeconds);
  gitAt(repo, when, "add", "--all");
  gitAt(repo, when, "commit", "--quiet", "--allow-empty", "-m", message);
}

// n lines of code that define nothing other files could use.
export function filler(lineCount: number, prefix = "work"): string {
  return Array.from({ length: lineCount }, (_, index) => `  ${prefix}${index}();`).join("\n");
}
