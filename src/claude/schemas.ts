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

export const deepCheckSchema = {
  type: "object",
  properties: {
    units: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          plainWords: { type: "string", description: "What the code does, in 2-3 plain sentences, with an ASCII diagram in a ``` block and an everyday analogy when they help." },
          blockingProblems: {
            type: "array",
            items: {
              type: "object",
              properties: {
                file: { type: "string" },
                line: { type: "integer" },
                why: { type: "string" },
                howToShowFailure: { type: "string", description: "An input or a test that shows the failure." },
              },
              required: ["file", "line", "why", "howToShowFailure"],
            },
          },
          questions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                text: { type: "string", description: "Starts with 'Check:'." },
                startLine: { type: "integer", description: "First line in the new version of the unit's file." },
                endLine: { type: "integer" },
              },
              required: ["text", "startLine", "endLine"],
            },
          },
          checked: {
            type: "array",
            items: {
              type: "object",
              properties: { what: { type: "string" }, where: { type: "string" } },
              required: ["what", "where"],
            },
          },
          onlyYouCanCheck: { type: "array", items: { type: "string" } },
          unconfirmed: { type: "array", items: { type: "string" } },
        },
        required: ["id", "plainWords", "blockingProblems", "questions", "checked", "onlyYouCanCheck", "unconfirmed"],
      },
    },
  },
  required: ["units"],
};

export const ownershipCheckSchema = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["understood", "almost", "not yet"] },
    feedback: {
      type: "string",
      description: "The reply to the reviewer: the answer to his question, and for the verdict what is right, missing or wrong. ASCII diagrams go in ``` blocks.",
    },
    line: { type: "integer", description: "For 'not yet': the line of the new code the mistake is about." },
  },
  required: ["verdict", "feedback"],
};
