export type Tier = "critical" | "check" | "skim";

export const tiers: Tier[] = ["critical", "check", "skim"];

// Pass 1's answer for one unit.
export interface UnitSorting {
  tier: Tier;
  // One sentence: the concrete risk that decides the tier.
  reason: string;
  // Set when the change may not be worth having: new complexity or API surface for little gain.
  worthHaving?: string;
}

// Time and tokens of one Claude run, as the CLI reports them.
export interface RunRecord {
  pass: "overview" | "deep check" | "ownership check";
  durationMilliseconds: number;
  inputTokens: number;
  outputTokens: number;
  fromCache: boolean;
}
