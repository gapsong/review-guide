import * as path from "path";
import { folderKey } from "../git/headCopy";
import { readJsonFile, writeJsonFile } from "../state/jsonFile";
import { EntryChatReply, EntryCheck, EntryRecord } from "./entryOwnership";

// The checks and chats of the owner's codemap entries, one JSON file per workspace folder, in the
// extension's own storage, never in the repo. Built like the ConfirmationStore of the change markers.
export class EntryOwnershipStore {
  constructor(private readonly folder: string) {}

  recordOf(repoFolder: string, repoPath: string): EntryRecord | undefined {
    return this.read(repoFolder).entries[repoPath];
  }

  saveCheck(repoFolder: string, repoPath: string, check: EntryCheck): void {
    this.change(repoFolder, repoPath, (record) => {
      record.check = check;
    });
  }

  // One exchange of the chat: the owner's message and Claude's reply.
  saveChatTurn(repoFolder: string, repoPath: string, message: string, reply: EntryChatReply): void {
    this.change(repoFolder, repoPath, (record) => {
      record.conversation.push({ speaker: "owner", text: message }, { speaker: "claude", reply });
    });
  }

  private change(repoFolder: string, repoPath: string, update: (record: EntryRecord) => void): void {
    const file = this.read(repoFolder);
    const record = file.entries[repoPath] ?? { conversation: [] };
    update(record);
    file.entries[repoPath] = record;
    writeJsonFile(this.fileOf(repoFolder), file);
  }

  private read(repoFolder: string): OwnershipFile {
    return readJsonFile<OwnershipFile>(this.fileOf(repoFolder), { repoFolder, entries: {} });
  }

  // The folder's own path is in the file too, so a person can tell the files apart.
  private fileOf(repoFolder: string): string {
    return path.join(this.folder, `${folderKey(repoFolder)}.json`);
  }
}

interface OwnershipFile {
  repoFolder: string;
  entries: Record<string, EntryRecord>;
}
