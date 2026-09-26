import { ReviewUnit, unitDiffText, unitTitle } from "../review/reviewUnit";

export function ownershipPrompt(unit: ReviewUnit, explanation: string): string {
  return `Review Guide pass: ownership check

The reviewer reviews a pull request and wants to own its code: understand what it does, even though an agent may have written it. He explained one critical unit in his own words. Compare his explanation with the code (read the whole function and what it calls; you have read-only tools) and answer with one verdict:
- understood: his explanation is right and covers what matters.
- almost: it is right, but misses something that matters; name it as a question he can answer himself (e.g. "What happens at a 3-bit word boundary?"). Do not give him the answer.
- not yet: something in it is wrong; say what, and give the line of the new code it is about.

Judge the understanding, not the wording. Be strict: "understood" means he could debug this code at 3am.

### U1: ${unit.file}  ${unitTitle(unit)}  (new lines ${unit.newRange.start}-${unit.newRange.end})
\`\`\`diff
${unitDiffText(unit)}
\`\`\`

## The reviewer's explanation
${explanation.trim()}
## End of explanation`;
}
