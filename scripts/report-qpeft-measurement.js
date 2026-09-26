// Scores a qpeft measurement (from scripts/measure-qpeft.js) against the reviewer's gold list (SPEC.md,
// Q1-Q3) and writes a Markdown report.
//   node scripts/report-qpeft-measurement.js <measurement.json> <report.md>
const fs = require("fs");

// the reviewer's gold list (2026-09-26), as file + function names. "strict" is the narrow reading of each
// entry; "generous" adds the helpers that implement the named behavior.
const goldList = [
  { area: "Quantization formula and STE", file: "qpeft/quant_schemes/reference.py", strict: ["_codes_ste"], generous: ["fake_quant", "quantize"] },
  { area: "Quantization formula and STE", file: "qpeft/quant_schemes/base.py", strict: ["_ste", "clamp_scale", "round_zero_point"], generous: [] },
  { area: "Packing and merge fold", file: "qpeft/packing.py", strict: ["pack_codes", "unpack_codes"], generous: ["_offsets"] },
  { area: "Packing and merge fold", file: "qpeft/quant_schemes/base.py", strict: ["merge"], generous: [] },
  { area: "Packing and merge fold", file: "qpeft/tuners/tuners_utils.py", strict: ["QuantLinear.merge"], generous: [] },
  { area: "tinygemm and code freezing", file: "qpeft/kernels/tinygemm.py", strict: ["tinygemm_zero", "TinyGemmLinear.__init__"], generous: [] },
  { area: "tinygemm and code freezing", file: "qpeft/tuners/tuners_utils.py", strict: ["QuantLinear.freeze_codes"], generous: [] },
  { area: "Block-AP and trainer defaults", file: "qpeft/block_ap.py", strict: ["run_block_ap"], generous: ["_to_float32", "_cast_params", "_norm_weights"] },
  { area: "Block-AP and trainer defaults", file: "qpeft/trainer.py", strict: ["QATTrainer.__init__"], generous: ["QATTrainingArguments"] },
  { area: "Block-AP and trainer defaults", file: "qpeft/tuners/qa_lora/layer.py", strict: ["ZeroPointFoldLoRA.forward", "ZeroPointFoldLoRA.folded_delta"], generous: [] },
];

function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  const measurement = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  fs.writeFileSync(outputPath, report(measurement));
}

// A unit matches a gold name when its symbol path ends with it ("merge" matches "_IntUniformScheme.merge").
function matchesName(unit, name) {
  return unit.symbolPath === name || unit.symbolPath.endsWith(`.${name}`);
}

function goldUnits(units, reading) {
  const gold = [];
  for (const entry of goldList) {
    const names = reading === "strict" ? entry.strict : [...entry.strict, ...entry.generous];
    for (const name of names) {
      const matching = units.filter((unit) => unit.file === entry.file && matchesName(unit, name));
      if (matching.length === 0) {
        gold.push({ area: entry.area, file: entry.file, name, unit: undefined });
      }
      for (const unit of matching) {
        gold.push({ area: entry.area, file: entry.file, name, unit });
      }
    }
  }
  return gold;
}

function score(units, reading) {
  const gold = goldUnits(units, reading);
  const goldSet = new Set(gold.map((entry) => entry.unit).filter(Boolean));
  const hits = gold.filter((entry) => entry.unit?.tier === "critical");
  const extraCritical = units.filter((unit) => unit.tier === "critical" && !goldSet.has(unit));
  const ruleForced = extraCritical.filter((unit) => (unit.reason ?? "").startsWith("Weakened test:"));
  return { gold, hits, extraCritical, ruleForced };
}

function report(measurement) {
  const units = measurement.units;
  const strict = score(units, "strict");
  const generous = score(units, "generous");
  const pass1 = measurement.runs.find((run) => run.pass === "overview");
  const hunkUnitsInPython = units.filter((unit) => unit.file.endsWith(".py") && unit.kind === "hunk").length;
  const lines = [
    "# Q1-Q3 measurement: gapsong/qpeft PR #8 (main...develop at 4369298)",
    "",
    `Head ${measurement.headSha}, merge base ${measurement.mergeBaseSha}. Model claude-opus-5-5. ${measurement.profile ? "Repo profile: the qpeft example from SPEC.md (measurements/qpeft-profile-from-spec.md)." : "No .review-guide.md on main, so Claude used the general rules."}`,
    "",
    "## Result",
    "",
    "| Check | Target | Strict reading | Generous reading |",
    "|---|---|---|---|",
    `| Q1 gold units tiered critical | all | ${strict.hits.length}/${strict.gold.length} | ${generous.hits.length}/${generous.gold.length} |`,
    `| Q2 critical units outside the gold list | at most 10 | ${strict.extraCritical.length} (${strict.ruleForced.length} weakened-test rule, ${strict.extraCritical.length - strict.ruleForced.length} by Claude) | ${generous.extraCritical.length} (${generous.ruleForced.length} rule, ${generous.extraCritical.length - generous.ruleForced.length} Claude) |`,
    `| Q3 time from opening the PR to the overview | at most 120 s | ${measurement.secondsToOverview.toFixed(0)} s | |`,
    "",
    `Units: ${units.length} (critical ${count(units, "critical")}, check ${count(units, "check")}, skim ${count(units, "skim")}). Python units that fell back to raw hunks: ${hunkUnitsInPython}.`,
    `Pass 1: ${(pass1.durationMilliseconds / 1000).toFixed(0)} s in Claude, ${pass1.inputTokens} tokens in, ${pass1.outputTokens} tokens out.`,
    `Pass 2: ${describeDeepCheck(measurement)}.`,
    "",
    "## Gold list, unit by unit",
    "",
    "| Area | File | Gold function | Unit | Tier | Claude's reason |",
    "|---|---|---|---|---|---|",
    ...generous.gold.map((entry) => {
      const reading = strict.gold.some((candidate) => candidate.file === entry.file && candidate.name === entry.name) ? "" : " (generous)";
      return `| ${entry.area} | ${entry.file} | ${entry.name}${reading} | ${entry.unit ? entry.unit.title : "not changed / not found"} | ${entry.unit?.tier ?? "-"} | ${cell(entry.unit?.reason)} |`;
    }),
    "",
    "## Critical units outside the gold list (strict reading)",
    "",
    "| File | Unit | Reason |",
    "|---|---|---|",
    ...strict.extraCritical.map((unit) => `| ${unit.file} | ${unit.title} | ${cell(unit.reason)} |`),
    "",
    "## What this PR does (Claude's summary)",
    "",
    measurement.summary ?? "",
    "",
    "## All units",
    "",
    "| Tier | File | Unit | Reason | Worth having? |",
    "|---|---|---|---|---|",
    ...["critical", "check", "skim"].flatMap((tier) =>
      units.filter((unit) => unit.tier === tier).map((unit) => `| ${tier} | ${unit.file} | ${unit.title} | ${cell(unit.reason)} | ${cell(unit.worthHaving)} |`)),
    "",
    "## Claude's draft .review-guide.md",
    "",
    "```markdown",
    measurement.draftProfile ?? "(none)",
    "```",
    "",
  ];
  return lines.join("\n");
}

function describeDeepCheck(measurement) {
  const runs = measurement.runs.filter((run) => run.pass === "deep check");
  if (runs.length === 0) {
    return measurement.status ?? "not run";
  }
  const seconds = runs.reduce((sum, run) => sum + run.durationMilliseconds, 0) / 1000;
  return `${runs.length} Claude calls, ${seconds.toFixed(0)} s of Claude time in total, done ${measurement.secondsToDeepCheckDone.toFixed(0)} s after opening`;
}

function count(units, tier) {
  return units.filter((unit) => unit.tier === tier).length;
}

function cell(text) {
  return (text ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

main();
