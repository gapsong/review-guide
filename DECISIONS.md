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
On 2026-10-07 VS Code 1.141 came out and three more things broke on macOS 27: the default streaming unzip of the download left an empty folder that was marked complete (now `extractSync`); the patched copy was killed at start because `product.json` is part of its signature (the test runner now signs the patched copy again, ad hoc, right after patching it, before its first start, since macOS blocks changes to an app that has run); and the re-signed copy was no longer known to the keychain, which would ask the person at the screen (the tests now start VS Code with `--use-inmemory-secretstorage --use-mock-keychain`).

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
- A changed entry starts its description with "⚠️ changed · " (with an en space after the emoji, see below). A warning icon in front of the row pushed it out of line with the others (seen in the real VS Code), and a color needs the row's `resourceUri`, which brings back a file icon in front; the emoji keeps its color in the grey description.
- At the usual 13 px VS Code draws emoji wider than the room the font gives them, so the badge's emoji touched each other and the name. In running text (the view's labels, its tooltip, the CodeLens, the panel's heading) they are set apart with a thin space and an en space; the Explorer badge cannot have them, it allows two characters.
- The filter is shown in the view's description ("💰 money only"); the button of the active filter is hidden and "Show All" appears instead, since a view title cannot show a pressed button.

## The notes and their limits

`why` and `watch` are one line each (300 and 200 characters): they are read in passing, in a tooltip.
`start` is a path, optionally with a line, and is checked like `path` (inside the workspace folder; a missing file is reported, the entry kept).
`mine` is the owner's own explanation and may span lines, up to 1500 characters, about two short paragraphs; longer belongs in the explanation page.
The Explorer hover and the CodeLens stay at the one sentence, so the code stays the main thing on screen.

## Change markers: what counts, and where confirmations live

- Only commits count. An uncommitted edit is work in progress; marking it would mark every file the owner is typing in.
- The check is `git log <confirmed>..HEAD -- <path>`, run by the extension itself, as the review runs do. `--literal-pathspecs` makes a path like `app/[id]/page.tsx` a file name, not a pattern. After a branch switch, `confirmed..HEAD` lists the commits on the new branch that the owner has not confirmed, which is what the marker should say.
- When the confirmed commit no longer exists (the history was rewritten), the entry is marked without a number of commits: what changed cannot be known, so the owner looks again.
- The first time an entry is seen, HEAD is its confirmation. A new codemap, or a new entry, therefore starts without a marker; the owner wrote it about the code as it is.
- Confirmations are JSON files in the extension's global storage, one per workspace folder, named by a hash of its path (the path itself is inside the file). Like the read marks, they are files and not VS Code's Memento, so they are easy to inspect and survive a restart in tests too. Nothing is written into the repo.
- The markers are checked again when git's `HEAD`, `logs/HEAD`, `packed-refs` or `refs/heads/**` change (a worktree keeps HEAD in its own git folder and the branches in the common one), when the codemap changes, and when the window gets the focus back, which catches a commit made in a terminal outside VS Code even if a file event was missed. VS Code's built-in git extension is not used: it can be turned off, and it is turned off in the tests.
- A folder where git fails shows no markers instead of an error message after every commit; the rest of the codemap still works.
- "Older than the last change" compares the commit time of the last commit that touched the path with the time `index.html` was written.
- "Explain again" only starts a new explanation. The marker stays until "Still true": a new page does not mean the owner has read it.

## Claude reads a clean copy of HEAD for the codemap

- "Check my words" and the tutor chat run in a copy of the workspace folder's HEAD (`git archive HEAD | tar -x`, no shell in between) in the extension's storage (`head-copies/<folder hash>/<commit>/`), not in the workspace folder. The copy is reused while HEAD stays; the copies of the two newest commits are kept.
- Why: a verdict belongs to exactly the commit that "commits since your check" counts from; ignored files (a `.env`) and untracked or half-done files never reach Claude (`--restricted` keeps the tools inside the working directory, and the working directory would otherwise be the repo, where Claude can read `.env`: checked by hand on 2026-10-09 with haiku, which returned the secret); parallel sessions that edit the folder do not disturb a run.
- The copy never holds the `.codemap` folder, even when it is committed, so the check cannot read an explanation page (D1). A committed symbolic link that points outside the copy, or nowhere, is removed from it.
- A partial clone is refused: `git archive` would fetch the missing blobs and so write into the repo's `.git`. For the same reason `git archive` runs with `GIT_LFS_SKIP_SMUDGE=1`: it applies the repo's smudge filters, and Git LFS's would fetch every large file into `.git/lfs`; the copy holds the pointer files instead. `export-ignore` paths and submodules are not in the copy.
- The path's git history (`history.txt`, the last 20 commits) is written into `entry-context/<folder hash>/<path hash>/`, the one extra folder Claude may read. The design named the folder after the path; a hash keeps the context of a folder entry from holding the contexts of the entries below it.

## Only a check of the owner's words counts (D1)

- The owner decided D1 on 2026-10-12: (b). An entry is understood only after a fresh check of `mine`. The check sees the entry and `mine`, never the chat and never the explanation page; `entryCheckPrompt` has no parameter for a conversation, so this holds by construction, and a test (D1) fails when the chat reaches the check's prompt.
- The chat is a tutor: its verdict is shown as "would be …" and changes no state. In the same call that explains, a "yes, as you say" can become "understood"; a grader that only sees the owner's own words cannot be talked into it.
- The price: good words from the chat must go into `mine` by hand. "Use my last message as mine" puts them on the clipboard as a `mine` block and opens the codemap at the entry; the extension never writes the codemap.
- Switching to (a) (the chat's latest verdict counts, as for PR units, F15) is one line: `chatVerdictCounts` in `src/codemap/entryOwnership.ts`. With it set, each chat turn is also stored as a check (and an understood one confirms the change marker), and the panel drops "would be".
- Until WP2 brings the quiz (D2), "owned" means understood words at a commit after which no commit touched the path.

## Own it in the codemap: where WP1 differs from its design

- The Codemap view's `contextValue` keeps its two values (`codemapEntry`, `codemapEntryChanged`) instead of getting a state suffix: no menu needs the state yet, and the C9 menus and tests stay as they were. "Own it" (inline) and "Check my words", "Show changes" (context menu) are offered on every entry; each explains itself when there is nothing to do (no words, no check, no change).
- The CodeLens has one lens more at the end for every entry: "✅ owned <date>", "🎯 Check your words again" after a commit, otherwise "🎯 Own it". The design showed only the first two; without the third, an entry that is not owned had no way into "Own it" from the code.
- `parseCodemap` and its result stay as they are; the line of an entry for "Edit in codemap" comes from a small second reader, `entryLineOf`, that runs only on a click. Adding the lines to the result would have changed every C2 test that compares a parsed codemap.
- "Show changes" takes both sides from git (`git show <commit>:<path>`, into `entry-sides/`), not the HEAD side from the HEAD copy: the text is the same, and the diff does not need a copy first.
- The 3am line names the next entry from money, then security (C13). "Own Next" goes on from there to deep modules and then to any entry not owned yet, so it always has a next step.
- The design's integration test for C10-C13 runs in the existing `codemap-view` suite, with the fake `claude` of that suite: `fake-claude-explain.js` hands every `claude -p` run to `fake-claude.js`, which has the passes "entry check" and "entry chat".


## God files: where the build differs from its design

- **The view sits in the Review Guide side bar, below Ownership.** The design put it "below Codemap", but the Codemap view lives in the Explorer; a view of ranked files with numbers belongs next to the other Review Guide views.
- **The history window ends at HEAD's commit time, not at the clock.** The design says "the last 90 days" and caches per HEAD. With the clock, a cached report would be wrong a day later, and the same commit would give different numbers on different days. Counting back from HEAD's commit makes the report a function of the commit (G1) and the cache always right. On a repo that is checked out at an old commit, the view shows the 90 days before that commit.
- **Co-change partners are measured source files only; a sweep is decided by all files of the commit.** A README, a lock file or a test that changes with the code is not another reason to change. The sweep limit (more than 25 files) counts every file, because a formatter run that also touches docs is still a sweep.
- **Tests are not users.** Breadth counts the source files that import a name. Tests reaching into internals are a finding for "Judge with Claude", not interface.
- **Re-exports are followed to the module that defines the name** (up to 4 hops). The design asked that a re-export counts as use; measured on fastapi, that alone left `fastapi/applications.py` with "1 name used by 1 file", because every user imports `FastAPI` from the package. Following the re-export gives "1 name used by 340 files": a deep module, as the rule says. A package's `__init__.py` also offers what it imports at module level, which is its interface.
- **A one-part specifier ("react", "fs") is never a repo file**; a path suffix needs two parts, or one part after an alias (`@/x`, `~/x`, `#x`). When two files have the suffix, the one sharing more folders with the importer wins; a tie is not counted, so a guess never makes a file broader.
- **No network, no lazy fetch.** Every git call of the measurement runs with `protocol.allow=never` and `GIT_NO_LAZY_FETCH=1`. In a partial (blobless) clone, the log uses exact renames only (`-M100%`): finding a rename that also changed the file needs old contents the clone may not have, and fetching them would write into its `.git`. A missing object is an error, never a fetch.
- **Refresh measures again and ignores the cache**; a HEAD move, a setting change and the first look at the view use it. The measurement is fast (under a second on 2,000 files), and the button should always mean a fresh run.
- **The judgment schema uses camelCase keys** (`verdictWhy`, `reasonsToChange`, `keepOrSplit`), like every other schema in `src/claude/schemas.ts`; the verdict values stay as designed (`god_file`, `deep_module`, `hub`, `ok`).
- **A proposed split for a file that is not called a god file is refused**, with the reason, instead of being dropped quietly; a reading-path or responsibility line outside the file is dropped, so it never becomes a link.
- **Judge with Claude refuses a partial clone**, as "Check my words" does: it uses the same HEAD copy, and `git archive` would fetch. The measurement still works there.
- **The `deep` hint follows the design literally**: at most 7 names used outside and at least 300 code lines, also when no other file uses the file (an entry point). It is a hint; the judgment says what the file is.
