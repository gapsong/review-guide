import { ReviewUnit } from "../review/reviewUnit";
import { findTestWeakening } from "../review/weakenedTests";
import { UnitSorting } from "./sorting";

// Claude's sorting, with the two rules that do not depend on Claude: a weakened test is always
// critical, and a unit Claude did not answer for still gets a tier and a reason.
export function finalSorting(unit: ReviewUnit, claudeSorting: UnitSorting | undefined): UnitSorting {
  const weakening = findTestWeakening(unit);
  if (weakening) {
    return { ...claudeSorting, tier: "critical", reason: weakening };
  }
  return claudeSorting ?? claudeGaveNoTier;
}

export const claudeGaveNoTier: UnitSorting = { tier: "check", reason: "Claude gave no tier for this change, so look at it yourself." };
