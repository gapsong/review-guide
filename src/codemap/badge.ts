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

// Text that starts with the badge: the Codemap view's labels, its tooltip and the CodeLens.
// At the usual 13 px, VS Code draws the emoji wider than the room the font gives them, so they
// touch each other and the name (seen in the real VS Code). A thin space between the emoji and an
// en space before the text keep them apart. The Explorer badge cannot have them: it allows two
// characters.
export function withBadge(entry: CodemapEntry, text: string): string {
  return `${spacedBadgeOf(entry)}${enSpace}${text}`;
}

// The badge with a thin space between its emoji, for the Explain panel's heading.
export function spacedBadgeOf(entry: CodemapEntry): string {
  return entry.deep ? `${labelEmoji[entry.label]}${thinSpace}${deepModuleEmoji}` : labelEmoji[entry.label];
}

const thinSpace = "\u2009";
const enSpace = "\u2002";

export function tooltipOf(entry: CodemapEntry): string {
  const parts = [entry.says, entry.label];
  if (entry.deep) {
    parts.push("deep module");
  }
  return parts.join(" · ");
}
