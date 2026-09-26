import { execFile } from "child_process";

export interface GitOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

export function runGit(args: string[], options: GitOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd: options.cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...options.env },
        maxBuffer: 256 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`git ${args.join(" ")} failed: ${stderr.trim() || error.message}`));
        } else {
          resolve(stdout);
        }
      },
    );
  });
}
