import * as vscode from "vscode";
import { runGit } from "../git/git";
import { parseRepo, repoFromRemoteUrl, RepoId, repoToString } from "./pullRequest";

// The repos from the "reviewGuide.repositories" setting, plus the GitHub repo open in VS Code.
export async function findConfiguredRepos(): Promise<RepoId[]> {
  const repos = [...reposFromSetting(), ...(await reposOfWorkspace())];
  return withoutDuplicates(repos);
}

function reposFromSetting(): RepoId[] {
  const names = vscode.workspace.getConfiguration("reviewGuide").get<string[]>("repositories", []);
  return names.map(parseRepo).filter((repo): repo is RepoId => repo !== undefined);
}

async function reposOfWorkspace(): Promise<RepoId[]> {
  const repos: RepoId[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const repo = await repoOfFolder(folder.uri.fsPath);
    if (repo) {
      repos.push(repo);
    }
  }
  return repos;
}

async function repoOfFolder(folderPath: string): Promise<RepoId | undefined> {
  try {
    const remoteUrl = await runGit(["remote", "get-url", "origin"], { cwd: folderPath });
    return repoFromRemoteUrl(remoteUrl);
  } catch {
    return undefined;
  }
}

function withoutDuplicates(repos: RepoId[]): RepoId[] {
  const seen = new Map<string, RepoId>();
  for (const repo of repos) {
    seen.set(repoToString(repo).toLowerCase(), repo);
  }
  return [...seen.values()];
}
