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

## Night run 0.3.0 (2026-10-07)

- [x] Step 0: commit the 0.2.0 work (3 commits; the private codemap fixture was swapped for a made-up one before its first commit, so it never entered the history)
- [x] Step 1: public-ready: no company content, no personal names, `reviewGuide.explanationLanguage`
- [x] Step 2: Codemap view in the Explorer, CodeLens on line 1, new entry fields why / watch / start / mine
- [x] Step 3: change markers after a commit, "Still true" and "Explain again"
- [ ] Step 4: generic check on a clone of gapsong/qpeft in the real VS Code, screenshots
- [ ] Finish: all test suites, version 0.3.0, package, morning report, Telegram
