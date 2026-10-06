import * as vscode from "vscode";
import type { ReviewGuideApi } from "../../src/extension";
import { FakeGitHub } from "../support/fakeGitHub";
import { fakeClaudePath } from "../support/testReviewGuide";

// The real GitHub login cannot be clicked in a headless run. Every suite starts VS Code with the
// built-in vscode.github-authentication disabled and registers this stand-in under the same id
// "github", already signed in as "tester". The test runner puts the extension on the test VS Code's
// trusted list, which stands in for the user's one "Allow" click.
export class StandInGitHubLogin implements vscode.AuthenticationProvider {
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
    return { id: "1", accessToken: this.token, account: { id: "tester", label: "tester" }, scopes };
  }
}

// Signs in, points the extension at the fake GitHub, the given repos and the fake `claude`, and activates it.
export async function startExtension(github: FakeGitHub, token: string, repos: string[]): Promise<ReviewGuideApi> {
  vscode.authentication.registerAuthenticationProvider("github", "GitHub (test)", new StandInGitHubLogin(token));
  const settings = vscode.workspace.getConfiguration("reviewGuide");
  await settings.update("githubApiUrl", await github.start(), vscode.ConfigurationTarget.Global);
  await settings.update("repositories", repos, vscode.ConfigurationTarget.Global);
  await settings.update("claudePath", fakeClaudePath, vscode.ConfigurationTarget.Global);
  return vscode.extensions.getExtension<ReviewGuideApi>("gapsong.review-guide")!.activate();
}
