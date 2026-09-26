// JSON schemas for the structured answers of each Claude pass (`--json-schema`).

const tier = { type: "string", enum: ["critical", "check", "skim"] };

export const overviewSchema = {
  type: "object",
  properties: {
    summary: { type: "string", description: "What this PR does, in 3 to 5 plain sentences." },
    readingOrder: { type: "array", items: { type: "string" }, description: "Unit ids in the order the reviewer should read them." },
    units: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          tier,
          reason: { type: "string", description: "One sentence: the concrete risk that decides the tier." },
          worthHaving: { type: "string", description: "Only if the change adds complexity or API surface for little gain; else empty." },
        },
        required: ["id", "tier", "reason"],
      },
    },
    draftProfile: { type: "string", description: "Only when the repo has no profile: a draft .review-guide.md." },
  },
  required: ["summary", "readingOrder", "units"],
};
