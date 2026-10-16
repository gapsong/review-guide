import { execFile, spawn } from "child_process";

// Git for the measurement: it reads, and it can never reach the network. protocol.allow=never
// refuses every transport, and GIT_NO_LAZY_FETCH stops a partial clone from fetching a missing
// object, which would write into the repo's .git; a missing object is an error instead.

const readOnlyEnvironment = { GIT_TERMINAL_PROMPT: "0", GIT_NO_LAZY_FETCH: "1", GIT_OPTIONAL_LOCKS: "0" };
const readOnlyConfig = ["-c", "protocol.allow=never", "-c", "core.quotePath=false"];

export function readGit(repoFolder: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      [...readOnlyConfig, ...args],
      { cwd: repoFolder, env: { ...process.env, ...readOnlyEnvironment }, maxBuffer: 1024 * 1024 * 1024 },
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

// The content of many blobs in one git process: "git cat-file --batch" answers each object id on
// stdin with "<id> blob <size>\n<content>\n".
export function readBlobs(repoFolder: string, objectIds: string[]): Promise<Buffer[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", [...readOnlyConfig, "cat-file", "--batch"], { cwd: repoFolder, env: { ...process.env, ...readOnlyEnvironment } });
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.on("error", (error) => reject(new Error(`git cat-file could not run: ${error.message}`)));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`git cat-file failed with exit code ${code}: ${Buffer.concat(errors).toString("utf8").trim()}`));
        return;
      }
      try {
        resolve(splitBatchOutput(Buffer.concat(chunks), objectIds.length));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(objectIds.map((id) => `${id}\n`).join(""));
  });
}

function splitBatchOutput(output: Buffer, count: number): Buffer[] {
  const blobs: Buffer[] = [];
  let offset = 0;
  for (let index = 0; index < count; index++) {
    const headerEnd = output.indexOf(0x0a, offset);
    const header = output.subarray(offset, headerEnd).toString("utf8");
    const match = /^(\S+) blob (\d+)$/.exec(header);
    if (!match) {
      throw new Error(`git cat-file did not return a file: ${header}`);
    }
    const size = Number(match[2]);
    blobs.push(output.subarray(headerEnd + 1, headerEnd + 1 + size));
    offset = headerEnd + 1 + size + 1;
  }
  return blobs;
}
