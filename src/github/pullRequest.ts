export interface RepoId {
  owner: string;
  name: string;
}

export interface PullRequest {
  repo: RepoId;
  number: number;
  title: string;
  body: string;
  author: string;
  url: string;
  cloneUrl: string;
  baseRef: string;
  baseSha: string;
  headRef: string;
  headSha: string;
}

export function repoToString(repo: RepoId): string {
  return `${repo.owner}/${repo.name}`;
}

export function parseRepo(text: string): RepoId | undefined {
  const match = /^([\w.-]+)\/([\w.-]+)$/.exec(text.trim());
  if (!match) {
    return undefined;
  }
  return { owner: match[1], name: match[2] };
}

// Accepts the usual remote forms: https://github.com/o/r(.git), git@github.com:o/r(.git), ssh://git@github.com/o/r.
export function repoFromRemoteUrl(remoteUrl: string): RepoId | undefined {
  const match = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(\.git)?\/?$/.exec(remoteUrl.trim());
  if (!match) {
    return undefined;
  }
  return { owner: match[1], name: match[2] };
}
