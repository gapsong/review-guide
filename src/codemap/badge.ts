import { CodemapEntry, CodemapLabel } from "./codemap";

// What a codemap entry looks like in the Explorer: a badge next to the name and a tooltip on hover.

const labelEmoji: Record<CodemapLabel, string> = {
  money: "💰",
  security: "🔒",
  core: "⚙️",
  feature: "🧩",
  util: "🧰",
};

const deepModuleEmoji = "🧠";

// VS Code shows at most two characters (as a person sees them) as a badge: the label first,
// then the brain for a deep module.
export function badgeOf(entry: CodemapEntry): string {
  return entry.deep ? labelEmoji[entry.label] + deepModuleEmoji : labelEmoji[entry.label];
}

export function tooltipOf(entry: CodemapEntry): string {
  const parts = [entry.says, entry.label];
  if (entry.deep) {
    parts.push("deep module");
  }
  return parts.join(" · ");
}
