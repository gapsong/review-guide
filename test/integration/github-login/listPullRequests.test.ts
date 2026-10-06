import * as assert from "assert";
import type { ReviewGuideApi } from "../../../src/extension";
import { FakeGitHub } from "../../support/fakeGitHub";
import { startExtension } from "../standInGitHubLogin";

// F1, through VS Code's authentication API with a stand-in login provider (see standInGitHubLogin.ts).
describe("F1: sign in with the VS Code GitHub login and list open PRs", () => {
  const token = "token-from-vscode-login";
  const github = new FakeGitHub(token);
  let api: ReviewGuideApi;

  before(async () => {
    github.addPull("example/qpeft", pull(8, "Block-AP trainer"));
    github.addPull("example/qpeft", pull(9, "Packing fix"));
    github.addPull("example/other", pull(3, "Docs"));
    api = await startExtension(github, token, ["example/qpeft", "example/other"]);
  });

  after(() => github.stop());

  it("lists the open PRs of every configured repo, using the token of the VS Code login", async () => {
    const tree = api.pullRequestTree;
    const repos = await tree.getChildren();
    assert.deepStrictEqual(repos.map((node) => tree.getTreeItem(node).label), ["example/qpeft", "example/other"]);

    const qpeftPulls = await tree.getChildren(repos[0]);
    assert.deepStrictEqual(qpeftPulls.map((node) => tree.getTreeItem(node).label), [
      "PR #8  Block-AP trainer",
      "PR #9  Packing fix",
    ]);
    const otherPulls = await tree.getChildren(repos[1]);
    assert.deepStrictEqual(otherPulls.map((node) => tree.getTreeItem(node).label), ["PR #3  Docs"]);

    assert.ok(github.receivedTokens.length >= 2);
    assert.ok(github.receivedTokens.every((received) => received === token));
  });
});

function pull(number: number, title: string) {
  return {
    number,
    title,
    cloneUrl: "https://example.invalid/repo.git",
    baseRef: "main",
    baseSha: "a".repeat(40),
    headRef: "develop",
    headSha: "b".repeat(40),
  };
}
