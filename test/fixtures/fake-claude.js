#!/usr/bin/env node
// Stands in for the `claude` CLI in tests: fast, deterministic, and it keeps a log of its calls.
//
// Environment:
//   FAKE_CLAUDE_LOG    file that gets one JSON line per call ({ pass, unitIds, cwd })
//   FAKE_CLAUDE_TIERS  JSON object { "<text in the unit's heading>": "critical" | "check" | "skim" };
//                      units that match nothing are "skim"
//   FAKE_CLAUDE_QUESTION_LINES  "<start>-<end>": deep check questions point there instead of at the unit
//   FAKE_CLAUDE_NO_QUESTIONS    "1": deep checks come without questions
//   FAKE_CLAUDE_OMIT            text in a unit's heading: pass 1 leaves that unit out of its answer
//   FAKE_CLAUDE_NO_QUESTIONS_FOR text in a unit's heading: that unit's deep check comes without questions
//   FAKE_CLAUDE_FAIL_SINGLE     "1": a deep check call for exactly one unit fails, like a crashed CLI
//
// It refuses to run unless it gets the read-only flags, so a change to them fails the tests.
const fs = require("fs");

const requiredFlags = [
  ["--permission-mode", "dontAsk"],
  ["--tools", "Read,Grep,Glob"],
  ["--allowedTools", "Read,Grep,Glob"],
  ["--disallowedTools", "Bash,Edit,Write,NotebookEdit,WebSearch,WebFetch,Task,Agent"],
  ["--output-format", "json"],
];

function main() {
  const args = process.argv.slice(2);
  const missing = requiredFlags.filter(([flag, value]) => args[args.indexOf(flag) + 1] !== value || !args.includes(flag));
  if (missing.length > 0 || !args.includes("--restricted") || !args.includes("--json-schema")) {
    process.stderr.write(`fake-claude: missing read-only flags ${JSON.stringify(missing)}\n`);
    process.exit(2);
  }
  const prompt = fs.readFileSync(0, "utf8");
  const pass = /^Review Guide pass: (.*)$/m.exec(prompt)[1].trim();
  const answer = answerFor(pass, prompt);
  log({ pass, unitIds: answer.unitIds, cwd: process.cwd() });
  delete answer.unitIds;
  process.stdout.write(JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 1200,
    result: JSON.stringify(answer),
    structured_output: answer,
    usage: { input_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 500, output_tokens: 200 },
  }));
}

function answerFor(pass, prompt) {
  if (pass === "overview") {
    return overview(prompt);
  }
  if (pass === "deep check") {
    return deepCheck(prompt);
  }
  if (pass === "ownership check") {
    return ownershipCheck(prompt);
  }
  throw new Error(`fake-claude: unknown pass ${pass}`);
}

// Unit headings in the prompts look like: "### U3: src/packing.ts  packCodes()  (new lines 3-9)"
function unitHeadings(prompt) {
  return [...prompt.matchAll(/^### (U\d+): (.*?)\s+\(new lines (\d+)-(\d+)\)/gm)].map((match) => ({
    id: match[1],
    heading: match[2],
    start: Number(match[3]),
    end: Number(match[4]),
  }));
}

function overview(prompt) {
  const tierRules = JSON.parse(process.env.FAKE_CLAUDE_TIERS || "{}");
  const omit = process.env.FAKE_CLAUDE_OMIT;
  const units = unitHeadings(prompt).filter((unit) => !omit || !unit.heading.includes(omit)).map((unit) => {
    const rule = Object.keys(tierRules).find((text) => unit.heading.includes(text));
    const tier = rule ? tierRules[rule] : "skim";
    return { id: unit.id, tier, reason: `Fake reason for ${unit.heading}.` };
  });
  return {
    summary: "Fake summary of the pull request.",
    readingOrder: units.map((unit) => unit.id),
    units,
    draftProfile: "## Critical\n- Fake draft",
    unitIds: units.map((unit) => unit.id),
  };
}

function deepCheck(prompt) {
  if (process.env.FAKE_CLAUDE_FAIL_SINGLE === "1" && unitHeadings(prompt).length === 1) {
    process.stderr.write("fake-claude: failing as asked\n");
    process.exit(1);
  }
  const noQuestionsFor = process.env.FAKE_CLAUDE_NO_QUESTIONS_FOR;
  const units = unitHeadings(prompt).map((unit) => ({
    id: unit.id,
    plainWords: `Fake plain words for ${unit.heading}.`,
    blockingProblems: [],
    questions: process.env.FAKE_CLAUDE_NO_QUESTIONS === "1" || (noQuestionsFor && unit.heading.includes(noQuestionsFor)) ? [] : [questionFor(unit)],
    checked: [{ what: "Read the function before and after", where: unit.heading.split(" ")[0] }],
    onlyYouCanCheck: ["Whether this matches the paper."],
    unconfirmed: [],
  }));
  return { units, unitIds: units.map((unit) => unit.id) };
}

function questionFor(unit) {
  const [start, end] = (process.env.FAKE_CLAUDE_QUESTION_LINES || `${unit.start}-${unit.end}`).split("-").map(Number);
  return { text: `Check: what happens at line ${start}?`, startLine: start, endLine: end };
}

// The reviewer's message decides the verdict, so tests can choose it: it contains "wrong", "partly", a
// question mark (Claude answers with a diagram), or none of these.
function ownershipCheck(prompt) {
  const message = /## The reviewer's new message\n([\s\S]*?)\n## End of message/.exec(prompt)[1].toLowerCase();
  const earlierTurns = (prompt.match(/^\*\*Reviewer:\*\*/gm) || []).length;
  const unitIds = [`turns-before:${earlierTurns}`];
  if (message.includes("wrong")) {
    return { verdict: "not yet", feedback: "Line 5 shifts by bits, not by the word size.", line: 5, unitIds };
  }
  if (message.includes("?")) {
    return { verdict: "almost", feedback: "Think of a staircase:\n```\n__|--|__\n```\nThe steps are flat.", unitIds };
  }
  if (message.includes("partly")) {
    return { verdict: "almost", feedback: "What happens at a 3-bit word boundary?", unitIds };
  }
  return { verdict: "understood", feedback: "Right, and it covers the word boundary.", unitIds };
}

function log(entry) {
  if (process.env.FAKE_CLAUDE_LOG) {
    fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify(entry) + "\n");
  }
}

main();
