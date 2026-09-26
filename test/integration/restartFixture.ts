import * as fs from "fs";
import * as path from "path";
import { createFixtureRemote, FixtureRemote, git } from "../support/gitFixture";
import { baseFiles, headFiles } from "../support/typescriptFixture";

// The same fixture repo for both halves of the restart test: the first VS Code session creates
// it in the runner's scratch folder, the second finds it there.
export function restartFixture(): FixtureRemote {
  const folder = path.join(process.env.REVIEW_GUIDE_TEST_SCRATCH!, "restart-fixture");
  const remotePath = path.join(folder, "remote");
  if (!fs.existsSync(remotePath)) {
    return createFixtureRemote(folder, baseFiles, headFiles, 21);
  }
  const baseSha = git(remotePath, "rev-parse", "main");
  const headSha = git(remotePath, "rev-parse", "refs/pull/21/head");
  return {
    remotePath,
    baseSha,
    headSha,
    pull: { number: 21, title: "Fixture PR", cloneUrl: remotePath, baseRef: "main", baseSha, headRef: "feature", headSha },
  };
}
