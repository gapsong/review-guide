// Runs every integration suite in a real VS Code. Each suite is one VS Code session.
// Suites that share a userDataDir run in order, which is how "survives a restart" is tested.
const path = require("path");
const os = require("os");
const fs = require("fs");
const { spawnSync } = require("child_process");
const { runTests } = require("@vscode/test-electron");

const root = path.resolve(__dirname, "..");
const suitesRoot = path.join(root, "out", "test", "integration");

function main() {
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
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "review-guide-it-"));
  const sharedUserData = path.join(scratch, "user-data-restart");
  const suites = [
    { name: "smoke" },
    { name: "github-login", disableBuiltinGitHubLogin: true },
    { name: "open-pr" },
    { name: "restart-part1", userDataDir: sharedUserData },
    { name: "restart-part2", userDataDir: sharedUserData },
    { name: "packaging" },
  ].filter((suite) => fs.existsSync(path.join(suitesRoot, suite.name)))
    .filter((suite) => !onlySuite || suite.name.startsWith(onlySuite));

  for (const suite of suites) {
    console.log(`\n=== integration suite: ${suite.name} ===`);
    await runSuite(suite, scratch);
  }
  fs.rmSync(scratch, { recursive: true, force: true });
}

function runSuite(suite, scratch) {
  const userDataDir = suite.userDataDir ?? path.join(scratch, `user-data-${suite.name}`);
  const launchArgs = [
    "--user-data-dir", userDataDir,
    "--extensions-dir", path.join(scratch, "extensions"),
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-workspace-trust",
  ];
  if (suite.disableBuiltinGitHubLogin) {
    launchArgs.push("--disable-extension", "vscode.github-authentication");
  }
  return runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(suitesRoot, suite.name, "index.js"),
    launchArgs,
    extensionTestsEnv: { REVIEW_GUIDE_TEST_SCRATCH: scratch },
  });
}

main();
