import { CodemapEntry } from "../codemap/codemap";
import { EntryChatTurn } from "../codemap/entryOwnership";
import { entryText } from "./explainPrompt";
import { explanationStyle } from "./explanationStyle";

// The two read-only passes about one codemap entry: the check of the owner's own words (`mine`),
// and the tutor chat. Both run in a copy of the repo at HEAD.
//
// The check sees the entry and the words, never the chat and never the explanation page, so a
// verdict is about what the owner keeps in their codemap, not about what Claude said to them
// (DECISIONS.md, D1). That is why entryCheckPrompt has no parameter for a conversation.

export interface EntryPromptContext {
  // The commit the repo copy holds.
  commit: string;
  // A folder Claude may read with the path's git history (history.txt).
  contextFolder: string;
  // The language the answer is written in (setting reviewGuide.explanationLanguage).
  language: string;
}

export function entryCheckPrompt(entry: CodemapEntry, context: EntryPromptContext): string {
  return `Review Guide pass: entry check

The owner keeps a codemap: their own map of this repo, one entry per important file or folder. For the entry below they wrote, in their own words, how it works ("mine"). Check those words against the code. Your working directory is a copy of the repo at commit ${context.commit}; read the code of the path and what it calls (you have read-only tools). The path's git history is in ${context.contextFolder}/history.txt.

Do not explain the code and do not teach: you are the examiner, not the tutor. Judge the understanding the words show:
- understood: right, and they tie the parts together: what happens, in which order, and why it is correct; they cover what the entry's says, why and watch name as what matters. The owner could debug this code at 3am.
- almost: right as far as they go, but something that matters is missing, or the parts are listed without how they connect. Name what is missing as one question the owner can answer themselves, e.g. "What happens to the row when the provider fails before the first token?"
- not yet: something they believe is wrong. Say what is wrong and give the file (a path in the repo) and the line of the code it is about.
Wording, length and style do not count, only whether the understanding is right. Words that only repeat the entry's says sentence are not understood.

Write the feedback in ${context.language}.

## The entry
${entryWithoutMine(entry)}
## The owner's words (mine)
${(entry.mine ?? "").trim()}
## End of words`;
}

export function entryChatPrompt(entry: CodemapEntry, conversation: EntryChatTurn[], message: string, context: EntryPromptContext): string {
  return `Review Guide pass: entry chat

The owner keeps a codemap: their own map of this repo, one entry per important file or folder. They want to own the entry below: understand what the code does, even though an agent may have written it. You are their tutor. Your working directory is a copy of the repo at commit ${context.commit}; read the code of the path and what it calls (you have read-only tools). The path's git history is in ${context.contextFolder}/history.txt.

Answer the owner's message fully and plainly: their question, or what is right, missing or wrong in what they wrote, with file:line where it helps. Then give a verdict on their understanding as their own messages show it so far (understood, almost or not yet; for "not yet", the file and line). The verdict is only a hint for them: what counts is a separate check of the words they keep in their codemap ("mine"), so encourage them to put what they learned there in their own words.

${explanationStyle}

Write in ${context.language}.

## The entry
${entryText(entry)}
${conversationSection(conversation)}
## The owner's new message
${message.trim()}
## End of message`;
}

function entryWithoutMine(entry: CodemapEntry): string {
  return entryText({ ...entry, mine: undefined });
}

function conversationSection(conversation: EntryChatTurn[]): string {
  if (conversation.length === 0) {
    return "";
  }
  const turns = conversation.map((turn) =>
    turn.speaker === "owner" ? `**Owner:** ${turn.text}` : `**Claude (would be ${turn.reply.verdict}):** ${turn.reply.feedback}`);
  return `\n## Conversation so far\n${turns.join("\n\n")}\n`;
}
