import * as assert from "assert";
import * as vscode from "vscode";
import type { ReviewGuideApi } from "../../../src/extension";
import { FakeGitHub } from "../../support/fakeGitHub";

// F1. The built-in GitHub login cannot be clicked in a headless run, so this suite starts VS Code
// with vscode.github-authentication disabled and registers a stand-in provider under the same id
// "github", already signed in as "reviewer". The test runner puts the extension on the test VS Code's
// trusted list, which stands in for the reviewer's one "Allow" click. The extension still goes through vscode.authentication.getSession("github").
describe("F1: sign in with the VS Code GitHub login and list open PRs", () => {
  const token = "token-from-vscode-login";
  const github = new FakeGitHub(token);
  let api: ReviewGuideApi;

  before(async () => {
    vscode.authentication.registerAuthenticationProvider("github", "GitHub (test)", new StandInGitHubLogin(token));
    github.addPull("reviewer/qpeft", pull(8, "Block-AP trainer"));
    github.addPull("reviewer/qpeft", pull(9, "Packing fix"));
    github.addPull("reviewer/other", pull(3, "Docs"));
    const apiUrl = await github.start();
    const settings = vscode.workspace.getConfiguration("reviewGuide");
    await settings.update("githubApiUrl", apiUrl, vscode.ConfigurationTarget.Global);
    await settings.update("repositories", ["reviewer/qpeft", "reviewer/other"], vscode.ConfigurationTarget.Global);
    api = await vscode.extensions.getExtension<ReviewGuideApi>("gapsong.review-guide")!.activate();
  });

  after(() => github.stop());

  it("lists the open PRs of every configured repo, using the token of the VS Code login", async () => {
    const tree = api.pullRequestTree;
    const repos = await tree.getChildren();
    assert.deepStrictEqual(repos.map((node) => tree.getTreeItem(node).label), ["reviewer/qpeft", "reviewer/other"]);

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

class StandInGitHubLogin implements vscode.AuthenticationProvider {
  private readonly changed = new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
  readonly onDidChangeSessions = this.changed.event;
  private sessions: vscode.AuthenticationSession[];

  constructor(private readonly token: string) {
    this.sessions = [this.sessionFor(["repo"])];
  }

  async getSessions(): Promise<vscode.AuthenticationSession[]> {
    return this.sessions;
  }

  async createSession(scopes: readonly string[]): Promise<vscode.AuthenticationSession> {
    const session = this.sessionFor(scopes);
    this.sessions = [session];
    this.changed.fire({ added: [session], removed: [], changed: [] });
    return session;
  }

  async removeSession(): Promise<void> {
    this.sessions = [];
  }

  private sessionFor(scopes: readonly string[]): vscode.AuthenticationSession {
    return { id: "1", accessToken: this.token, account: { id: "reviewer", label: "reviewer" }, scopes };
  }
}
