import * as assert from "assert";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath } from "@vscode/test-electron";
import { makeTempDir } from "../support/gitFixture";

const root = path.resolve(__dirname, "..", "..", "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { version: string };

describe("F9: `npm run package` builds a .vsix that installs in VS Code", function () {
  this.timeout(5 * 60 * 1000);
  let scratch: string;

  before(() => {
    scratch = makeTempDir("package");
  });

  after(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it("installs into a fresh VS Code and ships only the compiled extension", async () => {
    const vsixPath = path.join(root, "review-guide.vsix");
    fs.rmSync(vsixPath, { force: true });
    execFileSync("npm", ["run", "package"], { cwd: root, stdio: "pipe" });
    assert.ok(fs.existsSync(vsixPath), "npm run package wrote review-guide.vsix");

    const extensionsDir = path.join(scratch, "extensions");
    const code = await vscodeCli();
    const vscodeArgs = [...code.args, "--extensions-dir", extensionsDir, "--user-data-dir", path.join(scratch, "user-data")];
    execFileSync(code.command, [...vscodeArgs, "--install-extension", vsixPath], { stdio: "pipe" });
    const installed = execFileSync(code.command, [...vscodeArgs, "--list-extensions", "--show-versions"], { encoding: "utf8" });
    assert.ok(installed.split("\n").includes(`gapsong.review-guide@${packageJson.version}`), installed);

    const installedFolder = path.join(extensionsDir, `gapsong.review-guide-${packageJson.version}`);
    assert.ok(fs.existsSync(path.join(installedFolder, "out", "src", "extension.js")));
    assert.ok(!fs.existsSync(path.join(installedFolder, "out", "test")), "tests are not shipped");
    assert.ok(!fs.existsSync(path.join(installedFolder, "node_modules")), "no dependencies are shipped");
  });
});

// The test's own --extensions-dir and --user-data-dir replace the defaults of the test VS Code.
async function vscodeCli(): Promise<{ command: string; args: string[] }> {
  const [command, ...args] = resolveCliArgsFromVSCodeExecutablePath(await downloadAndUnzipVSCode("stable"));
  return { command, args: args.filter((arg) => !arg.startsWith("--extensions-dir") && !arg.startsWith("--user-data-dir")) };
}
