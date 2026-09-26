// Runs every integration suite in a real VS Code. Each suite is one VS Code session.
// Suites that share a userDataDir run in order, which is how "survives a restart" is tested.
const path = require("path");
const os = require("os");
const fs = require("fs");
const { spawnSync } = require("child_process");
const { downloadAndUnzipVSCode, runTests } = require("@vscode/test-electron");

const root = path.resolve(__dirname, "..");
const suitesRoot = path.join(root, "out", "test", "integration");
const extensionId = "gapsong.review-guide";

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
    { name: "github-login" },
    { name: "open-pr", withWorkspaceFolder: true },
    { name: "restart-part1", userDataDir: sharedUserData },
    { name: "restart-part2", userDataDir: sharedUserData },
  ].filter((suite) => fs.existsSync(path.join(suitesRoot, suite.name)))
    .filter((suite) => !onlySuite || suite.name.startsWith(onlySuite));

  const vscodeExecutablePath = await downloadAndUnzipVSCode("stable");
  for (const suite of suites) {
    console.log(`\n=== integration suite: ${suite.name} ===`);
    await runSuite(suite, scratch, vscodeExecutablePath);
  }
  fs.rmSync(scratch, { recursive: true, force: true });
}

function runSuite(suite, scratch, vscodeExecutablePath) {
  const userDataDir = suite.userDataDir ?? path.join(scratch, `user-data-${suite.name}`);
  const launchArgs = [
    "--user-data-dir", userDataDir,
    "--extensions-dir", path.join(scratch, "extensions"),
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-workspace-trust",
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

// Stands in for the one click a person makes the first time: "Allow Review Guide to sign in
// using GitHub". VS Code keeps that answer in its storage, but test runs use in-memory storage,
// so it cannot be stored ahead. VS Code's product.json has a list of extensions that are trusted
// for a login provider without asking; the downloaded test copy of VS Code gets this extension on it.
function trustExtensionForGitHubLogin(vscodeExecutablePath) {
  const productPath = findProductJson(vscodeExecutablePath);
  const product = JSON.parse(fs.readFileSync(productPath, "utf8"));
  const trusted = product.trustedExtensionAuthAccess ?? {};
  const githubTrusted = trusted.github ?? [];
  if (!githubTrusted.includes(extensionId)) {
    trusted.github = [...githubTrusted, extensionId];
    product.trustedExtensionAuthAccess = trusted;
    fs.writeFileSync(productPath, JSON.stringify(product, null, "\t"));
  }
}

function findProductJson(vscodeExecutablePath) {
  return path.join(path.dirname(vscodeExecutablePath), "resources", "app", "product.json");
}

main();
