import * as http from "http";
import { AddressInfo } from "net";

export interface FakePull {
  number: number;
  title: string;
  body?: string;
  cloneUrl: string;
  baseRef: string;
  baseSha: string;
  headRef: string;
  headSha: string;
}

// A tiny stand-in for the GitHub REST API: the open pulls of each repo.
export class FakeGitHub {
  readonly receivedTokens: string[] = [];
  private server: http.Server | undefined;
  private readonly pullsByRepo = new Map<string, FakePull[]>();

  constructor(private readonly expectedToken: string) {}

  addPull(repo: string, pull: FakePull): void {
    this.pullsByRepo.set(repo, [...(this.pullsByRepo.get(repo) ?? []), pull]);
  }

  async start(): Promise<string> {
    this.server = http.createServer((request, response) => this.answer(request, response));
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  async stop(): Promise<void> {
    await new Promise((resolve) => this.server?.close(resolve));
  }

  private answer(request: http.IncomingMessage, response: http.ServerResponse): void {
    const token = (request.headers.authorization ?? "").replace(/^Bearer /, "");
    this.receivedTokens.push(token);
    if (token !== this.expectedToken) {
      reply(response, 401, { message: "Bad credentials" });
      return;
    }
    const url = new URL(request.url ?? "/", "http://localhost");
    const pullsMatch = /^\/repos\/([^/]+\/[^/]+)\/pulls$/.exec(url.pathname);
    if (pullsMatch) {
      reply(response, 200, (this.pullsByRepo.get(pullsMatch[1]) ?? []).map(toGitHubPull));
    } else {
      reply(response, 404, { message: "Not Found" });
    }
  }
}

function reply(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function toGitHubPull(pull: FakePull): unknown {
  return {
    number: pull.number,
    title: pull.title,
    body: pull.body ?? "",
    html_url: `https://github.com/fake/pull/${pull.number}`,
    user: { login: "reviewer" },
    base: { ref: pull.baseRef, sha: pull.baseSha, repo: { clone_url: pull.cloneUrl } },
    head: { ref: pull.headRef, sha: pull.headSha },
  };
}
