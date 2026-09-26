# Measurements

Q1-Q3 of SPEC.md, measured on gapsong/qpeft PR #8 (main...develop at 4369298) with the real extension in VS Code (Pylance for Python symbols), the real GitHub API and Claude Opus 5.5.

Reproduce: `node scripts/measure-qpeft.js out.json [profile.md]` (set `PASS_ONE_ONLY=1` to skip pass 2), then `node scripts/report-qpeft-measurement.js out.json report.md`.

| Run | Pass 1 prompt | Profile | Q1 gold critical (strict) | Q2 extra critical | Q3 overview | File |
|---|---|---|---|---|---|---|
| 1 | first version, one call | none | 15/15 | 38 (10 were false weakened-test hits, since fixed) | 194 s | not kept |
| 2 | + "critical is well under a tenth", "follows" rule | none | 12/15 | 12 | 137 s | not kept |
| 3 | + parallel parts, "follows" rule reworded | none | 12/15 | 12 | 68 s | qpeft-pr8-run3-with-critical-budget.md |
| 4 | same as 3 | spec example | 11/15 | 12 | 68 s | not kept |
| 5 | final: without the "tenth" budget | spec example | 15/15 | 28 | 70 s | qpeft-pr8-with-spec-profile.md |
| 6 | final: without the "tenth" budget | none | 15/15 | 25 | 75 s | qpeft-pr8-without-profile.md |

Run 3 is the only one with pass 2 results in its file (24 critical units, 62 questions, none a default question). Run 4's pass 2 stopped at the Claude session limit.
