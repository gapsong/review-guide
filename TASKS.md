# Tasks

Checklist for the night run. One line per build step and per "Done when" criterion of SPEC.md.

## Build steps

- [x] 0. Test harness: TypeScript strict, ESLint, Mocha unit tests, VS Code integration tests under xvfb, MIT license
- [x] 1. Skeleton: GitHub login, list of PRs in the side bar
- [x] 2. Open a PR: worktree, review units, diff on click, guide panel
- [x] 3. Pass 1 with Claude, cache
- [x] 4. Pass 2, read marks, limit of 25
- [x] 5. Ownership check and ownership overview
- [x] 6. Codemap: badges in the Explorer, problems, Explain panel, explanation generated in a terminal (v0.2.0)

## Done when (automated)

- [x] F1 sign in with the VS Code GitHub login, list open PRs of the configured repos
- [x] F2 opening a PR checks out its head into a separate worktree; working copy unchanged
- [x] F3 every review unit gets a tier and one sentence why
- [x] F4 every critical unit gets at least one question tied to a line range in the new code
- [x] F5 clicking a unit opens the diff at that unit; guide panel shows tier, reason, questions
- [x] F6 read marks survive a restart of VS Code
- [x] F7 second run on the same head commit does not call Claude again
- [x] F8 more than 25 critical units: pass 2 waits for the user's agreement
- [x] F9 `npm run package` builds a .vsix that installs in VS Code
- [x] F10 lint, type check and all tests pass in `npm test`
- [x] F11 ownership check: understood / almost / not yet; only "understood" marks understood
- [x] F12 ownership overview per file across all PRs of a repo
- [x] F13 weakened test (removed assert, looser tolerance, new skip) is critical
- [x] F14 PR header shows the 3am check; "owned" only when all critical units are understood
- [x] F15 ownership check is a chat (ping-pong until understood, history stored, verdict can change)
- [x] F16 visual explanations (ASCII diagram + everyday analogy in pass 2 and chat prompts; monospace blocks in the panel)
- [x] S1 Claude cannot change a file, start a shell or reach the web
- [x] C1 Explorer badge and tooltip per codemap path; updates when the codemap file changes, no reload
- [x] C2 every codemap problem in the Problems view, on its line; no codemap file = no badges, no error
- [x] C3 "Explain" panel: entry, then the generated page with its links, images, GIFs and scripts; paths outside the codemap too
- [x] C4 "Generate explanation" / "Regenerate" runs Claude Code in a terminal with the prompt from media/explainPrompt.md; the panel refreshes when the page is written
- [x] C5 unit tests (parsing, badge, paths, panel HTML, prompt) and a codemap integration suite in a real VS Code
- [x] C6 Codemap view in the Explorer: tree with plain folders and compacted chains, badge + name + says, click, inline Explain, tooltip, filters, welcome text
- [x] C7 CodeLens on line 1 of a codemap file: badge + says, Explain
- [x] C8 optional notes why / watch / start / mine, checked with limits, shown in the view's tooltip and the Explain header
- [x] C9 change markers after a commit (view, tooltip, CodeLens, Explain header), Still true, Explain again, explanation older than the last change
- [x] C10 "Check my words": one read-only call on a clean HEAD copy, sees the entry and mine only; verdict stored with commit and hash of mine; partial clone refused
- [x] C11 "Own it" view in the Explain panel: mine, last check, tutor chat (verdicts only "would be"), stored, its own document
- [x] C12 a commit takes "understood" away (N commits, or gone); an understood check confirms the change marker; Still true alone does not restore it; Show changes
- [x] C13 ✅ owned in the view, state in tooltip and CodeLens, filter "not owned yet", 3am line of money and security, Own Next
- [x] S1 extended: the HEAD copy next to an ignored .env and .codemap (real claude, haiku)

## Manual (measured once, reported)

- [x] Q1 measured: 15/15 gold units critical (final prompt, with and without profile)
- [x] Q2 measured: 25 extra critical units without profile, 28 with the spec profile (target 10: NOT met)
- [x] Q3 measured: overview 75 s after opening (target 120 s)

## Found along the way
- [x] Nested functions (callbacks) belong to their outer function's unit, found with TypeScript symbols
- [x] Blank lines between functions do not make a unit of their own
- [x] VS Code's built-in git extension is disabled in tests; it rewrites .git/index in the background
- [x] S1 control run by hand: the same prompt with Edit/Write allowed does change the repo, so the S1 test can fail
- [x] First qpeft run: 10 new tests with CUDA/transformers skips were flagged as weakened; a skip now counts only in a test that existed before
- [x] Pass 1 took 170 s in one call on 314 units; now runs in parallel parts of about 80 units
- [x] A "critical is under a tenth" prompt budget was tried: Q2 12 but Q1 fell to 11-12/15; removed (DECISIONS.md)
- [x] Independent code review: 9 bugs fixed (typed explanation wiped, deleted-file click crash, questions not moving with a pushed unit, F7 with an omitted unit, hunk ids, dead units in the overview, close hang, double open, retry failure)
- [ ] Not fixed: the "not yet" line of an old ownership check does not move with its unit after a push
- [ ] Not fixed: after a small push the summary is rewritten from the changed units only
- [ ] Not fixed: PR list shows at most 100 open PRs (no pagination)
- [x] New requirements from the owner during the run: F15 and F16 added to SPEC.md, built and tested; one real Opus chat turn on the _ste example (measurements/ste-chat-example.md)
- [x] S1 flaked once: haiku reported its attempts in one entry; the "Claude ran" check now accepts any report (safety checks unchanged)
- [x] An iframe cannot load a webview's own files (measured in VS Code 1.140); the explanation page is the panel's document instead (DECISIONS.md)
- [x] Integration tests did not start on macOS: wrong product.json path, inherited ELECTRON_RUN_AS_NODE, socket path over 103 characters; all fixed, all suites pass on macOS
- [x] In the real VS Code the badge's emoji touched each other and the name, and a warning icon pushed a changed row out of line; both fixed (DECISIONS.md)
- [x] S1 flaked once in three runs: haiku declined in plain words, without the structured answer; the error now says what Claude wrote, and S1 asks again up to three times (a declined run proves nothing; the repo is still checked after all runs)
- [x] VS Code 1.141 on macOS 27: empty download folder, patched test copy killed at start, keychain prompts; all three fixed (DECISIONS.md)

## Night run 0.3.0 (2026-10-07)

- [x] Step 0: commit the 0.2.0 work (3 commits; the private codemap fixture was swapped for a made-up one before its first commit, so it never entered the history)
- [x] Step 1: public-ready: no company content, no personal names, `reviewGuide.explanationLanguage`
- [x] Step 2: Codemap view in the Explorer, CodeLens on line 1, new entry fields why / watch / start / mine
- [x] Step 3: change markers after a commit, "Still true" and "Explain again"
- [x] Step 4: generic check on a clone of gapsong/qpeft in the real VS Code, screenshots (emoji spacing and the changed row fixed)
- [x] Finish: all test suites, version 0.3.0, package, morning report, Telegram

## WP1 "Own it" (2026-10-09)

- [x] HEAD copy for Claude (git archive, no .codemap, no link that leaves the copy, partial clone refused)
- [x] Check my words and the tutor chat, stored per folder and path in the extension's storage (D1 = (b), decided by the owner; one switch in entryOwnership.ts)
- [x] Codemap view, tooltip, CodeLens, Explain panel ("Own it" view), filter, 3am line, Own Next, Show changes
- [x] S1 extended and run with real haiku; control by hand: in the repo itself as working directory, haiku does return the .env
- [x] Mutation check: giving the check the chat turns the D1 test red; switching off the commit rule turns the three C12 tests red
- [ ] Not fixed, found on Linux (also at 0298a33): VS Code's inotify watcher misses a file created together with its folder, so a codemap written into a new `.codemap/` folder, or an explanation page in a new folder, is only seen after the next change; C1, C2, C4 and "Explain again" fail on such a Linux host and pass on macOS

## God Files (2026-10-16)

- [x] G1 measurement from HEAD and history only: deterministic, read-only, no network; tests, generated and vendored code and the exclude globs left out
- [x] G2 ranking by breadth, areas and commits, never by length; hints `god file?` and `deep`
- [x] G3 breadth from the language server (document symbols, then references), class members included; barrels own no re-exported name; "–" with a reason, never 0; "8+" above 7 (second build: the regex name parsers are gone)
- [x] G4 one git log pass: commits in 90 days and co-change areas, sweeps left out, renames (exact only in a blobless clone)
- [x] G2 "knows N areas" from a module-level import scan, a ranking input; `deep` needs at most 3 known areas (assumption)
- [x] G5 God Files view: rows at once, breadth and complexity fill in, at most 5 numbers per row, tooltip with the hardest function (cognitive complexity: @barney-media/cognitive-typescript-core, complexipy), click to it, Refresh or a HEAD move cancels the running measurement
- [x] G6 codemap badge in the row, warning for `deep: true` on a broad file
- [x] G7 Judge with Claude: on demand, read-only in the HEAD copy, schema-checked, the Explain panel's escaped "Judge" view, kept per file and HEAD
- [x] S1 extended with the judge run (real claude, haiku); mutation checks (a)-(g) each turn a test red; speed in REPORT.md
- [ ] Not built (v1 scope): writing into the codemap, Explorer badges, split PRs
- [ ] Not tested automatically: Python breadth with a real Pylance (the test VS Code has none; one manual run on fastapi in REPORT.md)
- [ ] Not fixed: Python docstrings count as code lines (shown only, never scored)
