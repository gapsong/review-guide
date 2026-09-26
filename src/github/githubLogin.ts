import * as vscode from "vscode";

// "repo" is needed to read private repositories.
const scopes = ["repo"];

// Uses VS Code's own GitHub login, so the token stays in VS Code's secret storage.
export async function getGitHubToken(): Promise<string> {
  const session = await vscode.authentication.getSession("github", scopes, { createIfNone: true });
  return session.accessToken;
}
