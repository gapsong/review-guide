# Decisions

Where SPEC.md left room, this is the reading chosen and why. The guiding question each time: what best serves the reviewer owning his code again.

## Claude CLI is hardened beyond the spec's flags

The spec's call is kept as it is, plus four flags:
`--restricted --tools "Read,Grep,Glob" --strict-mcp-config --no-session-persistence`.

- `--restricted` ignores user, project and local settings files. Without it, a PR could ship its own `.claude/settings.json` with hooks or allow rules, and hooks run shell commands: PR code would run on the reviewer's machine. It also keeps the file tools inside the worktree (and the context folder added with `--add-dir`).
- `--tools "Read,Grep,Glob"` removes every other built-in tool, so nothing depends on the deny list being complete.
- `--strict-mcp-config` loads no MCP servers (the reviewer's MCP servers include ones that run code).
- `--no-session-persistence` keeps review runs out of the reviewer's Claude session history.
- `--bare` was tried and not used: it does not read the subscription login, so every run failed.

## Which repos are listed

"The configured repos" (F1) and "the repo that is open in VS Code" (user flow) are both honored: the side bar lists the repos in the `reviewGuide.repositories` setting plus the GitHub repo of each open workspace folder, without duplicates.

## How F1 is tested without clicking the login

The real GitHub login cannot be clicked in a headless run. The F1 suite starts VS Code with the built-in `vscode.github-authentication` extension disabled and registers a stand-in login provider under the same id `github`, already signed in. The extension's code path is the real one (`vscode.authentication.getSession("github", ["repo"])`), and the GitHub API is a local fake server that checks the token. The one "Allow" click a person makes the first time cannot be stored ahead, because VS Code keeps all storage in memory during test runs; instead the test runner adds the extension to `trustedExtensionAuthAccess` in the product.json of the downloaded test copy of VS Code (the same list VS Code uses for its own GitHub extensions).

## Storage is files, not VS Code's Memento

During test runs VS Code keeps `globalState` in memory, so a restart test could never pass with it. Read marks, explanations and the cache are JSON files in the extension's global storage folder, which also makes them easy to inspect.

## The worktree comes from the extension's own clone

The spec wants the PR head in "a git worktree in the extension's global storage". A worktree needs a parent repo. Using the reviewer's working copy as the parent would write into his `.git` (worktree metadata, fetched refs). Instead the extension keeps its own partial clone (`--filter=blob:none`, so a large repo is fast) per repo in global storage and adds the worktrees there. The reviewer's working copy and its `.git` are never touched, and a configured repo does not need to be cloned locally at all. The GitHub token reaches git through environment variables (`GIT_CONFIG_*`), never through the command line.

## What counts as a function

Functions, methods and constructors are units; classes (and structs, interfaces) are units for changes in their body outside methods. A function nested in another function (a callback, a local helper) belongs to the outer function's unit, because it is reviewed as part of it. Added or removed blank lines outside functions are ignored.

## The diff's two sides are files on disk

The left side of a diff is the base version of the file, written out under the PR's folder in global storage; the right side is the worktree file. Being plain files, both sides get document symbols from the normal language extensions (a virtual document scheme would not). A side where the file does not exist is an empty file.

## Weakened tests are found by a rule, not by Claude

F13 and Osmani's "the agent can't game its own scoreboard" point the same way: whether a test was weakened is decided by the extension itself, from the diff of test files (a removed assertion that is not replaced, a tolerance that got bigger or a number of decimal places that got smaller, an added skip or xfail). Such a unit is critical whatever Claude says, and the reason names what was weakened. Claude is also told the rule, so its reading order agrees.

## A unit Claude leaves out is "check"

F3 needs a tier and a reason for every unit. If Claude's answer misses a unit, the unit becomes "check" with the reason "Claude gave no tier for this change, so look at it yourself." It is not hidden in "skim", and it does not inflate "critical".

## The repo profile is read from the base branch

`.review-guide.md` is read at the merge base, not at the PR head, so a PR cannot change the rules its own review is sorted by.

## Pass 1 cache and a new push

The cache file of a PR holds the head commit and pass 1's answer per unit hash. A second run on the same head finds every unit and calls no Claude (F7). After a new push, only units whose hash is not in the cache are sent to Claude; the unchanged ones are listed in the prompt as context, and the summary is rewritten by that run. The cache stays after a PR is closed in the extension (only the worktree is removed), so reopening is free.

## Context folder: log and diff, no blame

The extension writes the PR description, commit messages, the full diff and the recent git log of each changed file into a context folder that Claude may read (`--add-dir`). Blame is left out: on a partial clone it would download the history of every changed file, which would cost more time than pass 1 itself.

## Pass 2 runs in batches, and every critical unit gets a question

Pass 2 sends 4 critical units per Claude call and runs up to 3 calls at once; each finished unit is stored at once, so the guide fills while the rest still runs. F4 needs at least one question per critical unit, tied to lines of the new code: line numbers from Claude are kept inside the file; a unit that comes back without a question is asked about once more on its own; if it still has none, the extension adds one default question ("Check: can you say what lines a-b do, and why they are correct?") and the guide says that it is the default, not Claude's.

## Asking before pass 2 does not block

Above 25 critical units the extension shows the number and asks with a normal (non-modal) notification; pass 1's result is usable while the question is open. Until the reviewer agrees, no pass 2 call is made; "Start Pass 2" in the PR's context menu starts it later.

## Read state per unit, per PR, per repo

Read marks live in one JSON file per repo, keyed by PR number and unit id, with the unit hash at the time. When a unit's hash changes on a new push, it steps back (understood -> read, read -> unread) and is flagged "changed since your review". A unit that was never read is not flagged.

## The latest explanation decides "understood"

A unit is "understood" exactly when Claude's verdict on the reviewer's latest explanation is "understood". A later explanation that is "almost" or "not yet" takes it back to "read": the state should say what he can explain now. Writing an explanation counts as having read the unit.

## Claude's summary is hidden, not just folded, until the reviewer has written his

"Folded" in the spec could mean a collapsed section one click away. That would make it too easy to peek, which defeats the check. The guide does not show Claude's plain-words summary at all until the reviewer has sent an explanation; after that it is shown open.

## Ownership overview counts critical units per PR

The overview sums, per file, the critical units of every PR opened in that repo (PRs closed in the extension included). A function that is critical in two PRs counts twice, once per PR, because each PR changed it and each change needs owning.

## "Owned" with no critical units

The 3am check says "owned" only when every critical unit is understood. A PR with no critical unit at all shows "3am: owned (no critical units)", so the header never claims more than it knows.

## Pass 1 runs in parallel parts for a large PR

The first real run on qpeft (314 units) took 170 s in one Claude call, over the 2 minutes of Q3. Pass 1 now splits the units into parts of about 80 (the units of one file stay together) and runs the parts at the same time. Each part sees the PR description and the titles of all other units, and is told to sort by the standard of the whole PR; part 1 writes the summary and the draft profile. On qpeft this brought the overview from 194 s to 68 s after opening.

## Reasons are short; skim units are left out of the reading order

Pass 1's output tokens were most of its time. Reasons are one sentence of at most 20 words, and the reading order lists only critical and check units (skim units need no order).

## Q1 over Q2: no critical budget in the prompt

Measured on qpeft (measurements/README.md): telling Claude that critical is "well under a tenth of the units" brought the extra critical units from about 25 to 12, but it also moved 3 to 4 of the reviewer's gold units (clamp_scale, freeze_codes, QATTrainer.__init__, the QA-LoRA mean pooling) to "check", and it overrode the repo profile. Without it, all 15 gold units are critical in both runs. A missed critical change is the failure that costs ownership; an extra critical unit costs a few minutes. So the prompt has no budget, and Q2 is not met (25 extra). Most extras are persistence and public defaults, which the spec's own general rules and the qpeft example profile both call critical.

## Integration tests run on macOS

The README said the VS Code integration tests do not start on macOS.
On 2026-10-05 three other causes were found and fixed, and all suites now pass on macOS: the test runner looked for the test VS Code's `product.json` next to the executable, which on macOS is in `Contents/Resources` instead; a terminal inside VS Code passes `ELECTRON_RUN_AS_NODE` on, which makes the test VS Code start as plain Node; and macOS allows socket paths of at most 103 characters, which the long user data folder names went over.
A patched `product.json` does not stop the test copy of VS Code 1.140 from starting.
