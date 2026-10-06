// The commands that act on one codemap entry. Each gets a CodemapTarget: from the Codemap view,
// a tooltip link or a CodeLens.
export const codemapCommands = {
  open: "reviewGuide.codemap.open",
  openStart: "reviewGuide.codemap.openStart",
  explain: "reviewGuide.codemap.explain",
  stillTrue: "reviewGuide.codemap.stillTrue",
  explainAgain: "reviewGuide.codemap.explainAgain",
} as const;
