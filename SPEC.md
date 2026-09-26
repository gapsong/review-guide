# Review Guide - VS Code extension

Status: draft v1, 2026-09-26.
Owner: The reviewer.

## Goal

A VS Code extension, "Review Guide", that pre-sorts a GitHub pull request with Claude, so the reviewer reviews the critical changes first and knows what to check at each one.

The extension does not review for you.
It pre-sorts the work and writes questions, so your attention goes to the changes that matter.

### Done when

Every item is either checked by an automated test or by a named manual check.
The goal is reached only when every item is met; a partly met item counts as not met.

Function (automated tests):
- F1: Sign in with the VS Code GitHub login and list the open PRs of the configured repos.
- F2: Opening a PR checks out its head into a separate git worktree; the user's working copy is not changed.
- F3: Every review unit of the PR gets a tier (critical / check / skim) and one sentence why.
- F4: Every critical unit gets at least one question for the reviewer, tied to a line range in the new code.
- F5: Clicking a unit opens the diff (base vs head) at that unit, and the guide panel shows its tier, reason and questions.
- F6: Units can be marked as read; the marks survive a restart of VS Code.
- F7: A second run on the same head commit does not call Claude again (cache hit).
- F8: With more than 25 critical units, pass 2 does not start before the user agrees.
- F9: One command (`npm run package`) builds a `.vsix` file that installs in VS Code.
- F10: Lint, type check and all tests pass in one command (`npm test`).

Safety (automated test):
- S1: In a run, Claude cannot change a file, start a shell or reach the web; the test tries each and checks that the worktree is unchanged.

Quality (manual check on a fixed test PR):
- Q1: On the test PR, every unit on the reviewer's gold list is tiered critical.
- Q2: At most 10 units outside the gold list are tiered critical.

Test PR: gapsong/qpeft, main...develop at develop commit `4369298` (fixed, so results are comparable).
Gold list (the reviewer, 2026-09-26), every changed function in:
- Quantization formula and STE: `quant_schemes/reference.py` (codes with STE), `quant_schemes/base.py` (`_ste`, `clamp_scale`, `round_zero_point`).
- Packing and merge fold: `packing.py` (`pack_codes`, `unpack_codes`), `quant_schemes/base.py` (`merge`), `tuners/tuners_utils.py` (`QuantLinear.merge`).
- tinygemm and code freezing: `kernels/tinygemm.py` (`tinygemm_zero`, the `scales_and_zeros` layout), `tuners/tuners_utils.py` (`freeze_codes`).
- Block-AP and trainer defaults: `block_ap.py` (fp32 cast, norm training), `trainer.py` (bit-dependent learning rates), `tuners/qa_lora/layer.py` (mean pooling).
- Q3: The overview (pass 1) is shown within 2 minutes of opening the PR.

Readability (manual check by the reviewer):
- R1: The reviewer has read every source file and can explain each in his own words (see "Code style").

### Not done

- Any item above not met, or met only with a manual workaround.
- Tests that pass only because they were weakened or skipped.

## Non-goals (MVP)

- No automatic posting to GitHub.
  Nothing leaves your machine towards GitHub unless you press a button (later version).
- No creating or splitting PRs (later version).
- No "approve" verdicts from Claude.
  Claude writes questions and says what it checked, never "looks good".

## Existing tool

The official "GitHub Pull Requests" extension already lists PRs, opens diffs and posts comments.
It does not sort or guide.
Review Guide only adds the sorting and the guide; it can be used next to the official extension.

## User flow

1. Sign in with GitHub (VS Code's built-in GitHub login; no token is stored by the extension).
2. The side bar "Review Guide" lists the open PRs of the repos you choose.
3. You open a PR.
   The extension checks out the PR head into its own folder (a git worktree in the extension's global storage), so your working copy is not touched.
   The worktree is removed when the PR is closed in the extension.
   The side bar shows the PRs of the repo that is open in VS Code.
4. Pass 1 (overview) runs and fills the tree:

   ```
   PR #12  develop -> main                      [4/11 read]
   ├─ What this PR does (3-5 sentences)
   ├─ Critical
   │   ├─ quant_schemes/base.py  merge()         "Fold formula: does z - delta/s hold when s is clamped?"
   │   └─ packing.py  pack_codes                 "3-bit codes that cross a word boundary"
   ├─ Check
   │   └─ trainer.py  _block_ap_batches          "Row count of the last partial batch"
   └─ Skim
       └─ tests/*, README, docstrings
   ```

5. Pass 2 (deep check) starts by itself right after pass 1, in the background, for every critical unit, and adds the questions.
   With more than 25 critical units, the extension shows the number and asks before it starts pass 2.
6. You click a unit: the diff (base vs head) opens at that place, and the guide panel next to the diff shows the tier, the reason and the questions.
7. You mark the unit as read.

### Review unit

The unit of review is a changed function (or method, or class body), not a raw git hunk.
Git hunks are merged when they lie in the same function and split when one hunk touches several functions.
Changes outside any function (imports, module constants) form one unit per file.
Functions are found with VS Code's document symbols (the language extensions you have installed), so every language with such an extension works.
Without symbols for a file, the raw git hunks are the units.

## How Claude is used

Model: Claude Opus 5.5 (`claude-opus-5-5`) for both passes.

Claude runs as your local Claude Code CLI (`claude -p`), in the checked-out PR folder, with read-only tools.
It gathers the context it needs itself (read files, grep for callers, find tests).

### Why the CLI and not the Agent SDK

The extension is a personal tool.
It starts the `claude` you already use, logged in with your Claude subscription, so no API key is needed.
The Agent SDK would need an API key: Anthropic does not allow third-party products built on the SDK to offer the claude.ai login.
If the extension is ever shared with others, it has to move to the SDK with an API key.

### CLI call

```
claude -p --model claude-opus-5-5 --permission-mode dontAsk \
  --allowedTools "Read,Grep,Glob" \
  --disallowedTools "Bash,Edit,Write,NotebookEdit,WebSearch,WebFetch,Task,Agent" \
  --json-schema <schema of the pass> --output-format json
```

- Run with the PR worktree as working directory.
- The prompt goes in on stdin (the tool lists would otherwise swallow it).
- `--permission-mode dontAsk`: anything not allowed is denied, without a prompt.
- The result is structured JSON that follows the schema of the pass.

### No shell for Claude

Tested on 2026-09-26 with Claude Code 2.1.282: allowing only `Bash(git log:*)` still let `git log --output=file` write a file.
So Claude gets no shell at all.
The extension runs the git commands itself (log, diff, blame of the changed files) and writes the output into a context folder that Claude can read.
With the settings above, a test run could read and grep, and was denied shell, edit, write and web access; no file changed.

### Pass 1: overview (whole PR)

Input:
- PR title, description, commit messages.
- All review units with some surrounding lines.
- The repo profile (see below).

Output (structured JSON):
- Per unit: tier, one-sentence reason.
- A reading order.
- "What this PR does" in 3 to 5 sentences.

### Pass 2: deep check (critical units only)

Claude may read the whole repo (read-only).
For each critical unit it looks at: the full function before and after, its callers and callees, the tests that cover it, and the reference it must match (named in the repo profile).

Output (structured JSON) per unit:
- Questions for you ("Check: ..."), each tied to a line range.
- What Claude checked itself, and how (e.g. "read test_packing.py: 3-bit case covered").
- What only you can check.
- Anything Claude could not confirm is marked as unconfirmed.

### Repo profile: `.review-guide.md`

A short file in each repo, written by you once.
It tells Claude what matters in this repo, which the code alone cannot tell.

Example for qpeft:

```markdown
## Critical
- Quantization formula, STE, rounding order
- Packing layout (GPTQ), 3-bit word boundaries
- Merge fold into the zero-point
- dtype casts, config defaults
- Save / load format

## Source of truth
- Official EfficientQAT (OpenGVLab/EfficientQAT)
- peft (QA-LoRA comparison), the papers' formulas

## Skim
- Docstrings, log messages, README
```

Without a profile, Claude uses general rules (math, security, persistence, public API and defaults are critical; tests, docs and renames are skim).
On the first PR of a repo without a profile, Claude also writes a draft profile from the code.
The extension shows the draft; the reviewer edits it and saves it into the repo himself (the extension never writes into the repo).

## Data and state

- Cache key: (repo, PR number, head commit SHA, unit hash).
  A new push re-runs only units whose hash changed.
- After a new push, units that did not change stay marked as read; changed units become unread and are flagged "changed since your review".
- "Read" marks, cache and results are stored locally in the extension's storage.
  Nothing is written into your repos except the worktree folder managed by the extension.
- Per run the extension shows the time and the token use that the CLI reports.

## Safety

- Claude's tools are read-only: Read, Grep, Glob. No shell, no edit, no write, no web.
- PR code is never executed.
- The GitHub token comes from VS Code's login and stays in VS Code's secret storage.

## How the goal is built

- Built without stops until every automated criterion (F, S) is met.
- Small commits, pushed to the private repo gapsong/review-guide as they are made.
- The reviewer reviews commit by commit afterwards and runs the manual checks (Q, R) at the end.
- Build order:
  1. Skeleton: GitHub login, list of PRs in the side bar.
  2. Open a PR: worktree, review units, diff on click, guide panel.
  3. Pass 1 with Claude, cache.
  4. Pass 2, read marks, limit of 25.
- Installed locally from the `.vsix`; the Marketplace only after going public.

## Code style

The code is written to be read by a human first, like a well-liked LeetCode solution.
It will be made public later, so every file must make sense to a stranger.

- A main function reads like the steps of what it does; details go into small, well-named helpers below it.
- Plain names; no abbreviations except common ones (id, url, pr).
- No clever tricks; if a shorter version is harder to follow, use the longer one.
- Comments only for what the code cannot say itself (why, a pitfall, a link); never what the code does or its bug history.
- Small, focused commits; each one reviewable on its own.
- Behavior changes come with a test.

## Publishing

- Developed in the private repo gapsong/review-guide, made public later.
- License: MIT.
- Public users run their own local Claude Code CLI; nobody gets a login from the extension.
  Before going public, check the Claude Code terms word for word that this is allowed for a public extension.

## Later versions

- Post your own review comments to GitHub (button, never automatic).
- Split a large branch into small stacked PRs.
- Ownership check: you write 3 sentences per file in your own words, the tool shows what is still missing.
