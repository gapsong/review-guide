import { PullRequest, RepoId, repoToString } from "./pullRequest";

export interface Commit {
  sha: string;
  message: string;
}

// Only reads from GitHub. Nothing is ever posted (spec: no automatic posting).
export class GitHubClient {
  constructor(
    private readonly apiUrl: string,
    private readonly getToken: () => Promise<string>,
  ) {}

  async listOpenPullRequests(repo: RepoId): Promise<PullRequest[]> {
    const pulls = await this.get<GitHubPull[]>(`/repos/${repoToString(repo)}/pulls?state=open&per_page=100`);
    return pulls.map((pull) => toPullRequest(repo, pull));
  }

  async listCommits(pullRequest: PullRequest): Promise<Commit[]> {
    const commits = await this.get<GitHubCommit[]>(
      `/repos/${repoToString(pullRequest.repo)}/pulls/${pullRequest.number}/commits?per_page=100`,
    );
    return commits.map((commit) => ({ sha: commit.sha, message: commit.commit.message }));
  }

  private async get<T>(path: string): Promise<T> {
    const token = await this.getToken();
    const response = await fetch(this.apiUrl.replace(/\/$/, "") + path, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub answered ${response.status} for ${path}`);
    }
    return (await response.json()) as T;
  }
}

interface GitHubPull {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  user: { login: string } | null;
  base: { ref: string; sha: string; repo: { clone_url: string } };
  head: { ref: string; sha: string };
}

interface GitHubCommit {
  sha: string;
  commit: { message: string };
}

function toPullRequest(repo: RepoId, pull: GitHubPull): PullRequest {
  return {
    repo,
    number: pull.number,
    title: pull.title,
    body: pull.body ?? "",
    author: pull.user?.login ?? "",
    url: pull.html_url,
    cloneUrl: pull.base.repo.clone_url,
    baseRef: pull.base.ref,
    baseSha: pull.base.sha,
    headRef: pull.head.ref,
    headSha: pull.head.sha,
  };
}
