// Runs every integration suite in a real VS Code. Each suite is one VS Code session.
// Suites that share a userDataDir run in order, which is how "survives a restart" is tested.
const path = require("path");
const os = require("os");
const fs = require("fs");
const { spawnSync } = require("child_process");
const { downloadAndUnzipVSCode, runTests } = require("@vscode/test-electron");
const { trustExtensionForGitHubLogin } = require("./trust-github-login");

const root = path.resolve(__dirname, "..");
const suitesRoot = path.join(root, "out", "test", "integration");

function main() {
  // Started from a terminal inside VS Code, this variable is inherited and would make the test
  // copy of VS Code start as plain Node, which rejects VS Code's own options.
  delete process.env.ELECTRON_RUN_AS_NODE;
  if (needsVirtualDisplay()) {
    rerunUnderXvfb();
    return;
  }
  runAllSuites().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

function needsVirtualDisplay() {
  return process.platform === "linux" && !process.env.DISPLAY;
}

function rerunUnderXvfb() {
  const result = spawnSync("xvfb-run", ["-a", process.execPath, __filename, ...process.argv.slice(2)], { stdio: "inherit" });
  process.exit(result.status ?? 1);
}

async function runAllSuites() {
  const onlySuite = process.argv[2];
  // Short names: VS Code puts its IPC socket in the user data folder, and macOS allows socket
  // paths of at most 103 characters.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rg-it-"));
  const sharedUserData = path.join(scratch, "ud-restart");
  const suites = [
    { name: "smoke" },
    { name: "codemap", withWorkspaceFolder: true },
    { name: "codemap-view", withWorkspaceFolder: true },
    { name: "god-files", withWorkspaceFolder: true },
    { name: "github-login" },
    { name: "open-pr", withWorkspaceFolder: true },
    { name: "restart-part1", userDataDir: sharedUserData },
    { name: "restart-part2", userDataDir: sharedUserData },
  ].filter((suite) => fs.existsSync(path.join(suitesRoot, suite.name)))
    .filter((suite) => !onlySuite || suite.name.startsWith(onlySuite));

  // extractSync: on macOS 27 the default streaming unzip of VS Code 1.141 left an empty folder
  // behind, marked complete, and every later run failed.
  const vscodeExecutablePath = await downloadAndUnzipVSCode({ version: "stable", extractSync: true });
  for (const suite of suites) {
    console.log(`\n=== integration suite: ${suite.name} ===`);
    await runSuite(suite, scratch, vscodeExecutablePath);
  }
  fs.rmSync(scratch, { recursive: true, force: true });
}

function runSuite(suite, scratch, vscodeExecutablePath) {
  const userDataDir = suite.userDataDir ?? path.join(scratch, `ud-${suite.name}`);
  const launchArgs = [
    "--user-data-dir", userDataDir,
    "--extensions-dir", path.join(scratch, "extensions"),
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-workspace-trust",
    // The test copy is signed again on macOS (scripts/trust-github-login.js), so the keychain no
    // longer knows it and would ask the person at the screen. The tests need no stored secrets:
    // VS Code keeps them in memory, and Chromium uses a stand-in keychain.
    "--use-inmemory-secretstorage",
    "--use-mock-keychain",
    // VS Code's own git support refreshes .git/index in the background, which would blur the
    // "working copy unchanged" checks. The extension does not use it.
    "--disable-extension", "vscode.git",
  ];
  if (suite.withWorkspaceFolder) {
    // An empty folder; the suite clones its fixture repo into it, as the user's working copy.
    const workspaceFolder = path.join(scratch, `workspace-${suite.name}`);
    fs.mkdirSync(workspaceFolder, { recursive: true });
    launchArgs.unshift(workspaceFolder);
  }
  // Every suite signs in with a stand-in GitHub login; see test/integration/standInGitHubLogin.ts.
  launchArgs.push("--disable-extension", "vscode.github-authentication");
  trustExtensionForGitHubLogin(vscodeExecutablePath);
  return runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(suitesRoot, suite.name, "index.js"),
    launchArgs,
    extensionTestsEnv: { REVIEW_GUIDE_TEST_SCRATCH: scratch },
  });
}

main();
