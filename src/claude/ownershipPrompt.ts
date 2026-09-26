import { ReviewUnit, unitDiffText, unitTitle } from "../review/reviewUnit";
import { ChatTurn } from "../state/reviewState";
import { explanationStyle } from "./explanationStyle";

// One turn of the ownership chat: the unit's code, the conversation so far, and the reviewer's new message.
export function ownershipPrompt(unit: ReviewUnit, conversation: ChatTurn[], message: string): string {
  return `Review Guide pass: ownership check

The reviewer reviews a pull request and wants to own its code: understand what it does, even though an agent may have written it. You talk with him about one critical unit until he understands it. Read the whole function and what it calls (you have read-only tools).

${conversation.length === 0 ? firstTurn : laterTurn}

Every reply ends with one verdict on the reviewer's understanding as his own words show it so far:
- understood: he has it right and covers what matters; he could debug this code at 3am.
- almost: right, but something that matters is missing; name it.
- not yet: something he believes is wrong; say what, and give the line of the new code it is about.
Your own explanations do not count as his understanding: only "understood" marks the unit, and only when his words show it. Judge the understanding, not the wording.

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

const firstTurn = `This is the reviewer's first try: he explains the unit in his own words. Judge it. Do not explain the code to him yet: for "almost", name what is missing as a question he can answer himself (e.g. "What happens at a 3-bit word boundary?").`;

const laterTurn = `the reviewer has already tried once; the conversation so far is below. Now he may answer your question, try again, or ask you back ("why detach?"). Answer his question fully and plainly, so he understands, then judge his understanding again.`;

function conversationSection(conversation: ChatTurn[]): string {
  if (conversation.length === 0) {
    return "";
  }
  const turns = conversation.map((turn) =>
    turn.speaker === "reviewer" ? `**the reviewer:** ${turn.text}` : `**Claude (${turn.result.verdict}):** ${turn.result.feedback}`);
  return `\n## Conversation so far\n${turns.join("\n\n")}\n`;
}
