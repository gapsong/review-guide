// Runs the Q1-Q3 measurement (test/measurement/qpeft) in a real VS Code with the Python extension
// (Pylance gives the document symbols), a real GitHub token (from `gh auth token`) and the real
// Claude Code CLI. Writes the raw result to the path given as the first argument. An optional second
// argument is a .review-guide.md to use instead of the repo's (qpeft has none yet).
const path = require("path");
const os = require("os");
const fs = require("fs");
const { execFileSync, spawnSync } = require("child_process");
const { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath, runTests } = require("@vscode/test-electron");
const { trustExtensionForGitHubLogin } = require("./trust-github-login");

const root = path.resolve(__dirname, "..");

async function main() {
  const outputPath = path.resolve(process.argv[2] ?? "qpeft-measurement.json");
  if (process.platform === "linux" && !process.env.DISPLAY) {
    const result = spawnSync("xvfb-run", ["-a", process.execPath, __filename, ...process.argv.slice(2)], { stdio: "inherit" });
    process.exit(result.status ?? 1);
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "review-guide-measure-"));
  // Kept between runs (next to the downloaded VS Code): the Marketplace is not always reachable.
  const extensionsDir = path.join(root, ".vscode-test", "measure-extensions");
  const vscodeExecutablePath = await downloadAndUnzipVSCode("stable");
  installPythonExtension(vscodeExecutablePath, extensionsDir, scratch);
  trustExtensionForGitHubLogin(vscodeExecutablePath);
  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, "out", "test", "measurement", "qpeft", "index.js"),
    launchArgs: [
      "--user-data-dir", path.join(scratch, "user-data"),
      "--extensions-dir", extensionsDir,
      "--disable-extension", "vscode.github-authentication",
      "--disable-extension", "vscode.git",
      "--disable-workspace-trust",
    ],
    extensionTestsEnv: {
      REVIEW_GUIDE_GITHUB_TOKEN: execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim(),
      REVIEW_GUIDE_CLAUDE: process.env.REVIEW_GUIDE_CLAUDE ?? path.join(os.homedir(), ".local", "bin", "claude"),
      REVIEW_GUIDE_MEASUREMENT_OUT: outputPath,
      REVIEW_GUIDE_MEASURE_PASS_ONE_ONLY: process.env.PASS_ONE_ONLY ?? "",
      REVIEW_GUIDE_MEASURE_PROFILE: process.argv[3] ? path.resolve(process.argv[3]) : "",
    },
  });
  stopLeftoverClaudeRuns(scratch);
  fs.rmSync(scratch, { recursive: true, force: true });
}

// With PASS_ONE_ONLY=1 the measurement does not wait for pass 2; its Claude runs (working in this
// measurement's worktree) would otherwise go on after VS Code has closed.
function stopLeftoverClaudeRuns(scratch) {
  for (const pid of fs.readdirSync("/proc").filter((name) => /^\d+$/.test(name))) {
    try {
      if (fs.readlinkSync(`/proc/${pid}/cwd`).startsWith(scratch)) {
        process.kill(Number(pid));
      }
    } catch {
      // The process ended meanwhile, or belongs to another user.
    }
  }
}

function installPythonExtension(vscodeExecutablePath, extensionsDir, scratch) {
  if (fs.existsSync(extensionsDir) && fs.readdirSync(extensionsDir).some((name) => name.startsWith("ms-python.vscode-pylance"))) {
    return;
  }
  const [cli, ...args] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);
  const ownArgs = args.filter((arg) => !arg.startsWith("--extensions-dir") && !arg.startsWith("--user-data-dir"));
  execFileSync(cli, [...ownArgs, "--extensions-dir", extensionsDir, "--user-data-dir", path.join(scratch, "cli-user-data"), "--install-extension", "ms-python.python"], { stdio: "inherit" });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
