import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { RunClaude } from "../claude/claudeCli";
import { entryChatPrompt, entryCheckPrompt, EntryPromptContext } from "../claude/entryCheckPrompt";
import { entryCheckSchema } from "../claude/schemas";
import { commitExists, commitsTouching, headOf } from "../codemap/changeMarkers";
import { CodemapEntry } from "../codemap/codemap";
import { chatVerdictCounts, CommitsSinceCheck, EntryChatReply, EntryCheck, EntryRecord, hashOfMine, ownershipStateOf, OwnershipState } from "../codemap/entryOwnership";
import { EntryOwnershipStore } from "../codemap/entryOwnershipStore";
import { cleanRelativePath } from "../codemap/repoPath";
import { runGit } from "../git/git";
import { folderKey, HeadCopies, HeadCopy } from "../git/headCopy";
import { Verdict } from "../state/reviewState";

// "Check my words" and the tutor chat for codemap entries, without VS Code: each is one read-only
// Claude call in a copy of the workspace folder's HEAD, and its result is kept in the extension's
// storage. Only commits count, as for the change markers (C9): a check belongs to the commit it read.

export interface EntryChecksOptions {
  // The extension's global storage; the copies, the stored checks and the context files go below it.
  storageFolder: string;
  runClaude: RunClaude;
  language: () => string;
  // An "understood" check also confirms the entry's change marker at the checked commit.
  confirmAt: (repoFolder: string, repoPath: string, commit: string) => void | Promise<void>;
  now?: () => Date;
}

// The commits since the check, and the files they changed, for "Show changes".
export interface ChangesSinceCheck {
  checkedCommit: string;
  // "f3c1a2b Fix the fallback (#391)", newest first; empty when the checked commit is gone.
  commits: string[];
  // Repo paths changed between the checked commit and HEAD, below the entry's path.
  files: string[];
  commitIsGone: boolean;
}

export class EntryChecks {
  private readonly copies: HeadCopies;
  private readonly store: EntryOwnershipStore;
  private readonly contextRoot: string;
  private readonly now: () => Date;

  constructor(private readonly options: EntryChecksOptions) {
    this.copies = new HeadCopies(path.join(options.storageFolder, "head-copies"));
    this.store = new EntryOwnershipStore(path.join(options.storageFolder, "codemap-ownership"));
    this.contextRoot = path.join(options.storageFolder, "entry-context");
    this.now = options.now ?? (() => new Date());
  }

  recordOf(repoFolder: string, repoPath: string): EntryRecord | undefined {
    return this.store.recordOf(repoFolder, repoPath);
  }

  // "Check my words": the entry and mine, and nothing else, go to one read-only call.
  async check(repoFolder: string, entry: CodemapEntry): Promise<EntryCheck> {
    const mine = requireMine(entry);
    const copy = await this.copies.copyOf(repoFolder);
    const context = await this.promptContext(repoFolder, entry, copy);
    const run = await this.options.runClaude<EntryChatReply>({
      prompt: entryCheckPrompt(entry, context),
      schema: entryCheckSchema,
      workingDirectory: copy.folder,
      readableFolders: [context.contextFolder],
    });
    const check = this.checkOf(replyOf(run.answer), copy.commit, mine, run.durationMilliseconds);
    await this.keepCheck(repoFolder, entry.path, check);
    return check;
  }

  // One turn of the tutor chat: the entry, mine and the conversation so far.
  async chat(repoFolder: string, entry: CodemapEntry, message: string): Promise<EntryChatReply> {
    const copy = await this.copies.copyOf(repoFolder);
    const context = await this.promptContext(repoFolder, entry, copy);
    const conversation = this.store.recordOf(repoFolder, entry.path)?.conversation ?? [];
    const run = await this.options.runClaude<EntryChatReply>({
      prompt: entryChatPrompt(entry, conversation, message, context),
      schema: entryCheckSchema,
      workingDirectory: copy.folder,
      readableFolders: [context.contextFolder],
    });
    const reply = replyOf(run.answer);
    this.store.saveChatTurn(repoFolder, entry.path, message.trim(), reply);
    if (chatVerdictCounts && entry.mine !== undefined) {
      await this.keepCheck(repoFolder, entry.path, this.checkOf(reply, copy.commit, entry.mine, run.durationMilliseconds));
    }
    return reply;
  }

  // The state of every entry; empty when the folder has no commit to count from.
  async statesOf(repoFolder: string, entries: CodemapEntry[]): Promise<Map<string, OwnershipState>> {
    const states = new Map<string, OwnershipState>();
    const head = await headOf(repoFolder);
    if (head === undefined) {
      return states;
    }
    for (const entry of entries) {
      const record = this.store.recordOf(repoFolder, entry.path);
      const commitsSince = record?.check ? await commitsSinceCheck(repoFolder, record.check.commit, head, entry.path) : undefined;
      states.set(entry.path, ownershipStateOf(entry, record, commitsSince));
    }
    return states;
  }

  async changesSinceCheck(repoFolder: string, repoPath: string): Promise<ChangesSinceCheck | undefined> {
    const check = this.store.recordOf(repoFolder, repoPath)?.check;
    if (!check) {
      return undefined;
    }
    if (!(await commitExists(repoFolder, check.commit))) {
      return { checkedCommit: check.commit, commits: [], files: [], commitIsGone: true };
    }
    const range = `${check.commit}..HEAD`;
    const log = await runGit(["--literal-pathspecs", "log", "--format=%h %s", range, "--", repoPath], { cwd: repoFolder });
    const names = await runGit(["--literal-pathspecs", "diff", "--name-only", "--relative", check.commit, "HEAD", "--", repoPath], { cwd: repoFolder });
    return { checkedCommit: check.commit, commits: nonEmptyLines(log), files: nonEmptyLines(names), commitIsGone: false };
  }

  private checkOf(reply: EntryChatReply, commit: string, mine: string, durationMilliseconds: number): EntryCheck {
    return { ...reply, commit, mineHash: hashOfMine(mine), checkedAt: this.now().toISOString(), durationMilliseconds };
  }

  private async keepCheck(repoFolder: string, repoPath: string, check: EntryCheck): Promise<void> {
    this.store.saveCheck(repoFolder, repoPath, check);
    if (check.verdict === "understood") {
      await this.options.confirmAt(repoFolder, repoPath, check.commit);
    }
  }

  // Claude gets no shell, so the extension writes the path's history where Claude may read it.
  private async promptContext(repoFolder: string, entry: CodemapEntry, copy: HeadCopy): Promise<EntryPromptContext> {
    const pathKey = createHash("sha256").update(entry.path).digest("hex").slice(0, 16);
    const contextFolder = path.join(this.contextRoot, folderKey(repoFolder), pathKey);
    fs.mkdirSync(contextFolder, { recursive: true });
    const history = await runGit(["--literal-pathspecs", "log", "-n", "20", "--format=%h %ad %an: %s", "--date=short", copy.commit, "--", entry.path], { cwd: repoFolder });
    fs.writeFileSync(path.join(contextFolder, "history.txt"), `# git log of ${entry.path}, newest first\n${history}`);
    return { commit: copy.commit, contextFolder, language: this.options.language() };
  }
}

function requireMine(entry: CodemapEntry): string {
  if (entry.mine === undefined) {
    throw new Error(`${entry.path} has no words of yours yet: add "mine: |" with your own explanation to its entry in the codemap, then check them.`);
  }
  return entry.mine;
}

// Only what the schema allows is kept; a file and line only for "not yet", and only a path inside the repo.
// An answer outside the schema (Claude wrote prose that happened to parse as JSON) is refused, so no
// made-up verdict reaches the store or the panel.
function replyOf(answer: EntryChatReply): EntryChatReply {
  const verdicts: Verdict[] = ["understood", "almost", "not yet"];
  if (!verdicts.includes(answer.verdict) || typeof answer.feedback !== "string") {
    throw new Error(`Claude Code's answer is not a verdict with feedback: ${JSON.stringify(answer).slice(0, 300)}`);
  }
  const reply: EntryChatReply = { verdict: answer.verdict, feedback: answer.feedback };
  const file = typeof answer.file === "string" ? cleanRelativePath(answer.file) : undefined;
  if (answer.verdict === "not yet" && file !== undefined) {
    reply.file = file;
  }
  if (answer.verdict === "not yet" && Number.isInteger(answer.line) && answer.line! > 0) {
    reply.line = answer.line;
  }
  return reply;
}

async function commitsSinceCheck(repoFolder: string, checkedCommit: string, head: string, repoPath: string): Promise<CommitsSinceCheck> {
  if (!(await commitExists(repoFolder, checkedCommit))) {
    return "gone";
  }
  return commitsTouching(repoFolder, `${checkedCommit}..${head}`, repoPath);
}

function nonEmptyLines(text: string): string[] {
  return text.split("\n").map((line) => line.trim()).filter((line) => line !== "");
}
