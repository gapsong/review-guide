# Decisions

Where SPEC.md left room, this is the reading chosen and why. The guiding question each time: what best serves you owning your code again.

## Claude CLI is hardened beyond the spec's flags

The spec's call is kept as it is, plus four flags:
`--restricted --tools "Read,Grep,Glob" --strict-mcp-config --no-session-persistence`.

- `--restricted` ignores user, project and local settings files. Without it, a PR could ship its own `.claude/settings.json` with hooks or allow rules, and hooks run shell commands: PR code would run on the reviewer's machine. It also keeps the file tools inside the worktree (and the context folder added with `--add-dir`).
- `--tools "Read,Grep,Glob"` removes every other built-in tool, so nothing depends on the deny list being complete.
- `--strict-mcp-config` loads no MCP servers (a reviewer's MCP servers may include ones that run code).
- `--no-session-persistence` keeps review runs out of the reviewer's Claude session history.
- `--bare` was tried and not used: it does not read the subscription login, so every run failed.

## Which repos are listed

"The configured repos" (F1) and "the repo that is open in VS Code" (user flow) are both honored: the side bar lists the repos in the `reviewGuide.repositories` setting plus the GitHub repo of each open workspace folder, without duplicates.

## How F1 is tested without clicking the login

The real GitHub login cannot be clicked in a headless run. The F1 suite starts VS Code with the built-in `vscode.github-authentication` extension disabled and registers a stand-in login provider under the same id `github`, already signed in. The extension's code path is the real one (`vscode.authentication.getSession("github", ["repo"])`), and the GitHub API is a local fake server that checks the token. The one "Allow" click a person makes the first time cannot be stored ahead, because VS Code keeps all storage in memory during test runs; instead the test runner adds the extension to `trustedExtensionAuthAccess` in the product.json of the downloaded test copy of VS Code (the same list VS Code uses for its own GitHub extensions).

## Storage is files, not VS Code's Memento

During test runs VS Code keeps `globalState` in memory, so a restart test could never pass with it. Read marks, explanations and the cache are JSON files in the extension's global storage folder, which also makes them easy to inspect.

## The worktree comes from the extension's own clone

The spec wants the PR head in "a git worktree in the extension's global storage". A worktree needs a parent repo. Using the reviewer's working copy as the parent would write into its `.git` (worktree metadata, fetched refs). Instead the extension keeps its own partial clone (`--filter=blob:none`, so a large repo is fast) per repo in global storage and adds the worktrees there. The working copy and its `.git` are never touched, and a configured repo does not need to be cloned locally at all. The GitHub token reaches git through environment variables (`GIT_CONFIG_*`), never through the command line.

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

A unit is "understood" exactly when Claude's verdict on the reviewer's latest explanation is "understood". A later explanation that is "almost" or "not yet" takes it back to "read": the state should say what the reviewer can explain now. Writing an explanation counts as having read the unit.

## Claude's summary is hidden, not just folded, until the reviewer has written theirs

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

Measured on qpeft (measurements/README.md): telling Claude that critical is "well under a tenth of the units" brought the extra critical units from about 25 to 12, but it also moved 3 to 4 of the owner's gold units (clamp_scale, freeze_codes, QATTrainer.__init__, the QA-LoRA mean pooling) to "check", and it overrode the repo profile. Without it, all 15 gold units are critical in both runs. A missed critical change is the failure that costs ownership; an extra critical unit costs a few minutes. So the prompt has no budget, and Q2 is not met (25 extra). Most extras are persistence and public defaults, which the spec's own general rules and the qpeft example profile both call critical.

## Generating an explanation is not a read-only run

The review runs (both passes and the ownership chat) stay read-only, and S1 is unchanged.
Generating an explanation (C4) cannot be read-only: to show real screenshots, recordings and GIFs, Claude must run the app and render images, and it must write the page.
So it is a different kind of run, with three guards instead of the tool lists: it starts only when the owner presses the button; it runs visibly in a terminal, where the owner sees every step; and it runs under Claude Code's normal permission prompts, with the owner's own settings, not with `--permission-mode dontAsk`.
It writes into `.codemap/explanations/`, the owner's personal, gitignored folder; the extension itself still never writes into a repo.

## Claude Code is the terminal's process, not a command typed into a shell

The task asked to quote the prompt for the shell.
Instead, the terminal runs `claude` directly (`shellPath` and `shellArgs`), with the prompt as its one argument, so there is no shell to quote for: a file name like `it's $(touch x).py` reaches Claude byte for byte and never runs.
This is safer than quoting, which depends on the shell (zsh, bash, fish and PowerShell quote differently), and it keeps a long, many-line prompt out of the shell's history.
When Claude Code ends, the terminal says so and stays open until the owner closes it.

## The explanation is the panel's own page, not an iframe

The task asked for an iframe whose `src` is the page's webview address.
Measured in VS Code 1.140 on 2026-10-05: such an iframe never loads, with or without a content security policy, and neither does an iframe with `srcdoc`.
VS Code serves a webview's files from a service worker that only answers the webview's own document; an iframe's navigation never reaches it.
What works is to make the page itself the webview's document, with `<base href>` set to the page's folder: relative images, GIFs, scripts and `fetch` then load from the explanations folder.
The panel's header (badge, path, sentence, label, buttons) is put on top of the page inside a shadow root, so the page's styles and the header's styles leave each other alone; it brings its own background, because the page may be light while VS Code is dark.

## What the explanation page may do

The `explain-visually` stepper uses an inline script and embeds its screenshots and fonts as `data:` URLs, so the page's policy allows inline scripts and `data:` images, media and fonts.
Everything else is limited to the webview's own address (`localResourceRoots` is the explanations folder), there are no frames, and nothing comes from the web: the prompt tells Claude to copy any library into the folder instead of linking a CDN.
The page's scripts cannot talk to the extension: the panel's script runs first and takes the one handle VS Code gives out, and it counts only real clicks, not clicks a script makes.
VS Code would send a link to one of the page's own files to the web browser, where it cannot load; the panel catches those clicks first and shows another page of the explanation in the panel, or opens another file (an image, a recording) in VS Code.

## A broken codemap shows nothing; a missing path is only reported

When the YAML itself is broken, the codemap shows no badges at all and the Problems view names the line: guessing what a broken file meant could show a wrong sentence next to a file.
An entry with a problem (unknown key, bad label, `deep` that is not a boolean, a `says` that is empty or over 160 characters, a path listed twice or one that could leave the workspace folder) is left out; all its problems are reported at once.
An entry whose path does not exist is reported and kept: it is still the owner's knowledge, and they decide whether the code moved or is gone.
All problems are warnings: the codemap is notes, not code that fails a build.

## Activation for the codemap

The badges must be there when the Explorer opens, before any Review Guide view or command is used.
The extension activates when the workspace contains `.codemap/codemap.yaml` (early), and on `onStartupFinished` for a codemap at another path (`reviewGuide.codemapFile`).
Activation does not call GitHub or Claude, so activating in every window costs little.
Because the extension now starts before anyone opens its views, the GitHub API address is read at every request, not once at activation; otherwise a changed `reviewGuide.githubApiUrl` would only count after a reload (the F1 test caught this).

## Integration tests run on macOS

The README said the VS Code integration tests do not start on macOS.
On 2026-10-05 three other causes were found and fixed, and all suites now pass on macOS: the test runner looked for the test VS Code's `product.json` next to the executable, which on macOS is in `Contents/Resources` instead; a terminal inside VS Code passes `ELECTRON_RUN_AS_NODE` on, which makes the test VS Code start as plain Node; and macOS allows socket paths of at most 103 characters, which the long user data folder names went over.
A patched `product.json` does not stop the test copy of VS Code 1.140 from starting.

## Written for anyone, not for one person

The repo is meant to go public, so it names no person and no company.
Code, prompts and docs say "the reviewer" (the person reading a pull request) or "the owner" (the person whose codemap it is); test data uses `example/...` repos and a made-up shop codemap.
Version 0.2.0 stored the reviewer's chat turns under the first user's name; the state store now reads every turn that is not Claude's as the reviewer's, so an old chat history still shows.
The language of a generated explanation is the setting `reviewGuide.explanationLanguage` (default English), not a sentence in the prompt.

## The Codemap view is the main surface, the Explorer badges stay

Tested in the real VS Code on 2026-10-06: for a folder that holds changed files, VS Code merges the decorations of the folder with the git decoration bubbled up from its children, and shows only the git dot and the tooltip "Contains emphasized items"; the codemap's badge and sentence are gone.
With many open changes, exactly the important folders showed nothing.
VS Code offers no way around this merge rule, so the codemap got its own view in the Explorer, where the badge and the sentence are always shown; the Explorer badges stay for files and unchanged folders.

## How the Codemap view is drawn

- Entries carry no icon: the badge emoji in the label already marks them, and an icon next to it would show two symbols for one thing. Plain folders get a grey folder icon, so they read as "only on the way" next to the entries.
- The tree does not use the entries' `resourceUri`: with it, VS Code would add the Explorer's decorations (the same badge again, and git colors) to every row.
- Commands from the view, a tooltip link and a CodeLens all get the same plain-text target (workspace folder and repo path), because a tooltip's command link and a CodeLens's arguments are JSON, where a `vscode.Uri` does not survive.
- The filter is shown in the view's description ("💰 money only"); the button of the active filter is hidden and "Show All" appears instead, since a view title cannot show a pressed button.

## The notes and their limits

`why` and `watch` are one line each (300 and 200 characters): they are read in passing, in a tooltip.
`start` is a path, optionally with a line, and is checked like `path` (inside the workspace folder; a missing file is reported, the entry kept).
`mine` is the owner's own explanation and may span lines, up to 1500 characters, about two short paragraphs; longer belongs in the explanation page.
The Explorer hover and the CodeLens stay at the one sentence, so the code stays the main thing on screen.

