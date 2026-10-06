import { ReviewUnit, unitDiffText, unitTitle } from "../review/reviewUnit";
import { ChatTurn } from "../state/reviewState";
import { explanationStyle } from "./explanationStyle";

// One turn of the ownership chat: the unit's code, the conversation so far, and the reviewer's new message.
export function ownershipPrompt(unit: ReviewUnit, conversation: ChatTurn[], message: string): string {
  return `Review Guide pass: ownership check

The reviewer reviews a pull request and wants to own its code: understand what it does, even though an agent may have written it. You talk with them about one critical unit until they understand it. Read the whole function and what it calls (you have read-only tools).

${conversation.length === 0 ? firstTurn : laterTurn}

Every reply ends with one verdict on the reviewer's understanding as their own words show it so far:
- understood: they have it right and cover what matters; they could debug this code at 3am.
- almost: right, but something that matters is missing; name it.
- not yet: something they believe is wrong; say what, and give the line of the new code it is about.
Your own explanations do not count as their understanding: only "understood" marks the unit, and only when their words show it. Judge the understanding, not the wording.

${explanationStyle}

### U1: ${unit.file}  ${unitTitle(unit)}  (new lines ${unit.newRange.start}-${unit.newRange.end})
\`\`\`diff
${unitDiffText(unit)}
\`\`\`
${conversationSection(conversation)}
## The reviewer's new message
${message.trim()}
## End of message`;
}

const firstTurn = `This is the reviewer's first try: they explain the unit in their own words. Judge it. Do not explain the code to them yet: for "almost", name what is missing as a question they can answer themselves (e.g. "What happens at a 3-bit word boundary?").`;

const laterTurn = `The reviewer has already tried once; the conversation so far is below. Now they may answer your question, try again, or ask you back ("why detach?"). Answer their question fully and plainly, so they understand, then judge their understanding again.`;

function conversationSection(conversation: ChatTurn[]): string {
  if (conversation.length === 0) {
    return "";
  }
  const turns = conversation.map((turn) =>
    turn.speaker === "reviewer" ? `**Reviewer:** ${turn.text}` : `**Claude (${turn.result.verdict}):** ${turn.result.feedback}`);
  return `\n## Conversation so far\n${turns.join("\n\n")}\n`;
}
