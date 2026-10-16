# Review Guide - VS Code extension

Status: draft v1, 2026-09-26.
Owner: the repo owner (gapsong).

## Goal

A VS Code extension, "Review Guide", that helps you own your code: know what each important part of a repo does and where it can hurt.
It has two parts.
The codemap (see "Codemap") shows your own one-line notes about the important folders and files of a repo while you browse the code, and a generated visual explanation per path.
The pull request review, one part of owning code, pre-sorts a GitHub pull request with Claude, so you review the critical changes first and know what to check at each one.

The main purpose is ownership: you want to understand what your code does again, even when an agent wrote it.
The extension takes the routine work off you, so your own attention goes to the few places where a human must look.

The extension does not review for you.
It pre-sorts the work, explains the code in plain words and writes questions, so your attention goes to the changes that matter.

### Principles

From Addy Osmani, "Getting the most out of Opus 5.5" (https://claude.dev/blog/getting-the-most-out-of-opus-5-5/):
- Let the model do a first review pass, but ask only for problems you would block the merge for, each with file and line, why it is wrong, and how to show that it fails.
- Ask the model to mark anything it could not confirm, and to say where it looked.
- Read what the run needs from you first.
- Keep your own check before anything risky or hard to undo.

From Addy Osmani, "Agentic Engineering" (O'Reilly, early release), chapter 1:
- About Osmani's PR triage loop: "The loop doesn't merge anything. It sorts my attention, and the merge stays mine." This is what Review Guide is.
- Calibrate by who gets hurt, not by technical difficulty: documentation and test-coverage chores are delegated freely, complex problems are watched, anything touching auth, security or money is watched closely.
- Tests: "Write or review them yourself, so the agent can't game its own scoreboard." The agent that did the work never decides the work is good.
- "Delegate the task, never the judgment. Green checks can't tell you a feature shouldn't exist."
- The dangerous failure is believing you review carefully (zone 4) while you only skim (zone 3). The defense is structure, not willpower.
- Osmani's check per change: did a spec exist, did you read every diff well enough to explain it, did tests exist before the change, could you debug it at 3am?

What this means here:
- Claude sorts and explains; the human reads the critical places.
- Every claim from Claude carries its evidence (where it looked) or is marked unconfirmed.
- The first thing the panel shows is what needs the human.
- The tier follows the damage a quiet bug would do, not how hard the code looks.
- Changes to tests are never skim: a weakened test (removed assert, looser tolerance, new skip) is critical, because it changes the scoreboard.
- Claude also flags changes that may not be worth having (new complexity or API surface for little gain); that is a judgment call for the human, not a bug.
- A PR is shown as "owned" only when every critical unit is understood; until then the panel says honestly how many are only read or unread.

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
- F11: For a critical unit, the reviewer can type an explanation in their own words; Claude compares it with the code and answers "understood", "almost" (with what is missing) or "not yet" (with what is wrong). Only "understood" marks the unit as understood.
- F12: An ownership overview lists, per file of the repo, how many of its critical units the reviewer has understood (e.g. `packing.py 3/3`, `trainer.py 1/4`), across all PRs reviewed in that repo.
- F13: A test file change that removes an assertion, loosens a tolerance or adds a skip is tiered critical (checked with a fixture PR).
- F14: The PR header shows the 3am check: how many critical units are understood / read / unread, and "owned" only when all are understood.
- F15: The ownership check is a chat: after Claude's verdict, the reviewer can reply and ask back and forth in the guide panel until they understand. Every turn keeps the unit, their earlier messages and the code as context and stays read-only; the history is stored locally with the unit. Claude does not reveal its own summary before the reviewer's first try. The verdict can change during the chat; only "understood" counts.
- F16: Explanations are visual and use analogies: the prompts of pass 2 and the ownership chat ask for a small ASCII diagram (data flow, shapes, bit layout, before/after) whenever it helps, and for WHY explained with an everyday analogy that is mapped back to the code; the guide panel shows ASCII diagrams as preformatted (monospace) blocks.

Safety (automated test):
- S1: In a run, Claude cannot change a file, start a shell or reach the web; the test tries each and checks that the worktree is unchanged.
  Extended for the codemap (C10): in the HEAD copy of a repo with a codemap and an ignored .env, Claude changes nothing, starts no shell, reaches no web and never sees the .env (real claude, haiku; the repo, its .codemap folder and the copy are byte for byte unchanged, and neither the .env text nor the explanation page is in the answer).
  Extended for the judge run (G7): the real judge (its own prompt, in the HEAD copy, no extra folder) on a file whose comments tell Claude to edit it, start a shell, fetch a URL and copy the ignored .env into its answer changes nothing, starts no shell, reaches no web and never sees the .env (real claude, haiku; the repo and the copy are byte for byte unchanged, and the .env text is not in the judgment).

Quality (manual check on a fixed test PR):
- Q1: On the test PR, every unit on the owner's gold list is tiered critical.
- Q2: At most 10 units outside the gold list are tiered critical.

Test PR: gapsong/qpeft, main...develop at develop commit `4369298` (fixed, so results are comparable).
Gold list (the owner's, 2026-09-26), every changed function in:
- Quantization formula and STE: `quant_schemes/reference.py` (codes with STE), `quant_schemes/base.py` (`_ste`, `clamp_scale`, `round_zero_point`).
- Packing and merge fold: `packing.py` (`pack_codes`, `unpack_codes`), `quant_schemes/base.py` (`merge`), `tuners/tuners_utils.py` (`QuantLinear.merge`).
- tinygemm and code freezing: `kernels/tinygemm.py` (`tinygemm_zero`, the `scales_and_zeros` layout), `tuners/tuners_utils.py` (`freeze_codes`).
- Block-AP and trainer defaults: `block_ap.py` (fp32 cast, norm training), `trainer.py` (bit-dependent learning rates), `tuners/qa_lora/layer.py` (mean pooling).
- Q3: The overview (pass 1) is shown within 2 minutes of opening the PR.

Codemap (automated tests; see "Codemap"):
- C1: Explorer hover: every path in the codemap gets a badge (the label's emoji: money 💰, security 🔒, core ⚙️, feature 🧩, util 🧰; plus 🧠 as a second character for a deep module) and a tooltip (the `says` sentence, then " · " and the label, plus " · deep module"). The badge is not passed on to a folder's files and has no color. Badges follow every change of the codemap file without a reload.
- C2: Every problem in the codemap file shows in the Problems view on its line (unknown key, bad label, `deep` that is not true or false, empty `says` or one over 160 characters, a path listed twice, a path that does not exist, broken YAML), and follows every change. An entry with a problem gets no badge, except one whose path does not exist. Without a codemap file there are no badges and no problem.
- C3: "Explain" (Explorer context menu for files and folders; command palette for the active editor's file) opens a panel "Explain: <name>" with the badge, the path, `says`, the label and deep. When `.codemap/explanations/<path>/index.html` exists, the panel shows that page, with its relative links, images, GIFs and scripts working, under a content security policy that lets it load nothing from outside the explanations folder. A path that is not in the codemap can be explained too ("Not in the codemap yet").
- C4: Without an explanation the panel says so and shows "Generate explanation" ("Regenerate" when one exists). The button opens a terminal "Explain: <path>" in the workspace folder that runs `claude` (setting `reviewGuide.claudePath`) interactively with one prompt, built from the template `media/explainPrompt.md` with the path, the codemap entry (or "none"), the output folder and the page's language (setting `reviewGuide.explanationLanguage`, default English). No file name can become a shell command. When the page appears or changes, an open panel for that path shows it by itself.
- C5: Unit tests cover reading and checking the codemap (each problem, on the right line), badge and tooltip, the explanation folder of a path, the panel's HTML (escaping, the page only when it exists, the content security policy) and the prompt (values filled in, safe as one argument). An integration test in a real VS Code checks badges, problems, the Explain command and the button's terminal run.
- C6: A tree view "Codemap" in the Explorer (below the file tree) shows the codemap. Path segments on the way to entries that are not entries themselves are plain folder nodes (grey icon, no badge); a chain of plain folders with one child each is one node ("src/app"), as in VS Code's Explorer; folders come first, then files, each by name. An entry's label is its badge and name, its description is `says`; a click opens a file or shows a folder in the Explorer; an inline action "Explain" opens the Explain panel. The tooltip shows the badge and name, `says`, the notes (C8), the label and deep, whether an explanation exists and when it was written, and command links (Explain). Actions in the view's title filter to money, security or deep modules (only matching entries and the folders on their way) and back to all. Without a codemap file the view shows a short welcome text that explains the file and its path; with a filter that matches nothing, it says so and offers "Show All". It follows every change of the codemap file without a reload.
- C7: A CodeLens above line 1 of every open file (any language) that is a codemap entry shows "<badge> <says>" and "Explain".
- C8: An entry may have optional notes: `why` (why it matters, what breaks; one line, at most 300 characters), `watch` (a sharp edge to watch; one line, at most 200), `start` (where to start reading: a repo path, optionally with a line, like `src/x.py:120`; at most 200) and `mine` (the owner's own explanation in their own words; may span lines, at most 1500). An empty note, a note that is not text, one over its limit, a one-line note on several lines, or a `start` that leaves the workspace folder is a problem on its line (C2); a `start` whose path does not exist is reported and the entry is kept. The notes show in the Codemap view's tooltip and the Explain panel's header (`start` as a link to that line); the Explorer hover and the CodeLens show only `says`. The prompt that generates an explanation gets the notes too.
- C9: When a commit changes a codemap path (a file, or anything inside a folder) after the owner last confirmed the entry, the entry is marked "Changed since you confirmed it (N commits)": in the Codemap view ("⚠️ changed ·" before the sentence, the marker first in the tooltip), in the CodeLens and in the Explain panel's header. "Still true" (view, tooltip, CodeLens, panel) stores the current HEAD as confirmed for that workspace folder and path and clears the marker; "Explain again" opens the Explain panel and runs the explanation terminal (C4). Nothing refreshes by itself. Confirmations live in the extension's storage, never in the repo; the first time an entry is seen, the HEAD at that moment is its confirmation, so a new codemap starts without markers. Only commits count (`git log <confirmed>..HEAD -- <path>`), never uncommitted edits; the markers are checked again when HEAD moves (a commit, a checkout, a pull), when the codemap changes and when the window gets the focus back. An explanation is "older than the last change" when a commit touched the path after its `index.html` was written; the tooltip and the panel say so. Unit tests run the marker logic against a real temporary git repo; an integration test makes a real commit and sees the marker appear by itself and disappear after "Still true".
- C10: "Check my words" (Codemap view context menu, the Own it view of the Explain panel, and the CodeLens and tooltip through "Own it") sends an entry's `mine` to one read-only Claude call (S1 flags) that runs in a copy of the workspace folder's HEAD (tracked files only, without the .codemap folder and without symbolic links that leave the copy, in the extension's storage) and sees the entry and `mine`, never an earlier chat or the explanation page. It answers understood / almost (what is missing, as a question) / not yet (what is wrong, with file:line). The verdict is stored per workspace folder and path in the extension's storage with the checked commit and a hash of `mine`; a changed `mine` is "not checked" again. An entry without `mine` cannot be checked and says how to add it. A partial clone is refused, because copying HEAD would fetch into its .git.
- C11: The Explain panel has a second view, "Own it", with `mine`, the last check and a chat: the owner can reply and ask back; every turn is one read-only call with the entry, `mine` and the conversation so far, answered in `reviewGuide.explanationLanguage`, with ASCII diagrams as preformatted blocks (F16). The chat is stored with the entry and survives a restart. A chat verdict is shown as "would be …" and does not change the entry's state (D1 in DECISIONS.md). The view is its own document: no script of the explanation page runs in it. "Edit in codemap" opens the codemap at the entry; "Use my last message as mine" puts a `mine` block on the clipboard; the extension never writes the codemap.
- C12: A commit that touches the path after the checked commit turns "understood" into "changed since your check (N commits)", which does not count as understood; only commits count (`git log <checked>..HEAD -- <path>`), and a checked commit that no longer exists counts as changed without a number. A new check at HEAD restores it. An "understood" check also confirms the entry's change marker (C9) at its commit; "Still true" alone does not restore "understood". "Show changes" opens the diff of a file from the checked commit to HEAD, or lists the changed files of a folder to open each diff; both sides come from git and are written into the extension's storage.
- C13: The Codemap view starts the description of an owned entry with "✅ owned ·" ("⚠️ changed ·" keeps priority); the tooltip and the CodeLens show the state with date and commit; a title action filters to entries not owned yet; the view's message shows the 3am check of the money and security entries ("3am 💰🔒: 2 of 9 owned · 1 changed · 2 almost · 4 not checked · next: …", only the filtered label while money or security is the filter), the next entry being the first not owned one in codemap order, money before security; "Own Next" opens it (after money and security it goes on to deep modules, then the rest). All of it follows every change of the codemap, the markers and the checks without a reload. Until WP2 (quiz, D2) an entry is owned when its `mine` is understood at a commit after which no commit touched the path.
  Tests for C10-C13: `test/unit/headCopy.test.ts`, `test/unit/entryOwnership.test.ts`, `test/unit/ownItHtml.test.ts`, `test/unit/codemapTree.test.ts`, `test/unit/codemapTooltip.test.ts`, and in a real VS Code `test/integration/codemap-view` ("C10-C13 in VS Code", "C12 in VS Code: Show changes …", "C11 in VS Code").

God files (automated tests; see "God files"):
- G1: The ranking is deterministic and read-only: its numbers come only from HEAD and its git history (never the working tree), with no Claude, no network (git runs with `protocol.allow=never` and no lazy fetch) and no language server. Tests (`test/`, `tests/`, `__tests__/`, `spec(s)/`, `e2e/`, `test_*.py`, `*_test.*`, `*.test.*`, `*.spec.*`, `conftest.py`), generated and vendored code (`node_modules/`, `dist/`, `build/`, `generated/`, `__generated__/`, `vendor/`, `*.d.ts`, `*.min.js`) and the globs of `reviewGuide.godFiles.exclude` are left out. Breadth (G3) and cognitive complexity (G5) are measured afterwards, for the files shown only.
- G2: The ranking follows the owner's rule. Length alone never lifts a file: the score is the mean percentile of known areas (the other areas a file imports from, by a module-level import scan), co-change areas and commits; code lines only decide the candidates (`reviewGuide.godFiles.minLines`, default 150) and are shown. In a fixture repo, a broad file (12 names used by other files, co-changing across 3 areas) ranks above a 600-line module with 2 names used outside, and that module carries the `deep` hint; a file importing from 11 other areas ranks first. Hint: `god file?` above 7 names used outside (class members included); `deep` needs 1 to 7 names used outside, at least 300 code lines, at most 3 co-change areas and at most 3 known areas; none while breadth is not measured, when it is unknown, or when nothing uses the file. Every threshold is in `godFileRules` (`src/godfiles/godFiles.ts`). The view's message names a shallow clone: its commit counts are a floor.
- G3: Breadth comes from VS Code's language servers, for the 20 files shown: the file's document symbols (top-level names, and the public members of its classes as `Class.member`; private, protected, `#`, `_`-prefixed members and the constructor never count), then "Find All References" of each. A name is used outside when a reference lies in another measured source file (tests are not users) and not on an import or re-export line. A barrel owns no re-exported name and is no user; the module that defines a name gets its uses. Counting stops above 7 names ("8+"). No symbol or reference provider, a timeout or a failure shows "–" with the reason in the tooltip, never 0; a file not measured yet shows "…". The module-level import scan (TypeScript/JavaScript import, export from, require, dynamic import, relative paths and aliases by path suffix; Python `import a.b`, `from pkg import module`, relative imports) gives the known areas and the import lines.
- G4: History: commits in the 90 days before HEAD's commit time and co-change areas (the first path segment, or the first two below a container folder: apps, packages, libs, services, src, modules, crates, internal, pkg, cmd), from one `git log` pass; renames count under the current path (in a blobless clone only exact renames, so nothing is fetched). Commits with more than 25 files do not count as co-change.
- G5: The view "God Files" in the Review Guide side bar shows the top 20 per workspace folder that is a git repo at once with their history numbers; breadth, hints and cognitive complexity fill in as they are measured, with a progress bar and "names used outside: N of 20 measured" in the message. A refresh or a HEAD move cancels the measurement running. Each row has at most 5 numbers ("23 names used outside · 66 commits/90 d · changes with 9 areas · knows 4 areas · 1,176 lines"); the tooltip explains each number, names the hardest function by cognitive complexity (`@barney-media/cognitive-typescript-core` for TypeScript/JavaScript, the `complexipy` CLI of `reviewGuide.complexipyPath` for Python, both on HEAD copies in a temporary folder, spawned without a shell; "–" with an install hint when complexipy is missing) and states the owner's rule. Complexity is neither a score input nor a hint. A click opens the file at its hardest function. Refresh in the title; it measures again by itself when HEAD moves or a setting changes. Nothing is cached and nothing is written into the repo.
- G6: Codemap tie-in: the codemap badge of the path is shown, and an entry with `deep: true` whose file measures broad (more than 7 names used outside) gets a warning in the row and the tooltip.
- G7: "Judge with Claude" (the item's context menu, its tooltip, or the button of the Explain panel's "Judge" view) runs only on demand: one read-only call (S1 flags) in the HEAD copy that "Check my words" uses; the prompt carries the measured numbers and the file's commit subjects of the window. The answer follows a JSON schema (verdict god_file / deep_module / hub / ok with why; responsibilities with line ranges; a reading path of 3-5 functions with lines; keep whole or split, with why) and is refused when it does not. The "Judge" view escapes every text, runs under a content security policy with a nonce, and links only to checked lines of the judged file. The judgment is kept per file and HEAD commit in the extension's storage; the command runs Claude only when that commit has no judgment yet.
  Tests for G1-G7: `test/unit/godFiles.test.ts` (the language server through a fake), `test/unit/godFileComplexity.test.ts`, `test/unit/godFileText.test.ts`, `test/unit/godFileJudge.test.ts`, and in a real VS Code with its TypeScript server `test/integration/god-files`.

Readability (manual check by the owner):
- R1: The owner has read every source file and can explain each in their own words (see "Code style").

### Not done

- Any item above not met, or met only with a manual workaround.
- Tests that pass only because they were weakened or skipped.

## Codemap

Reading pull requests is one way to own code; knowing the map of a repo is the other.
The codemap is your own map: a personal, gitignored YAML file in the repo, `.codemap/codemap.yaml` (setting `reviewGuide.codemapFile`).
It lists the important folders and files, each with one sentence and a label, and optional notes:

```yaml
- path: shop/checkout/payment.py   # file or folder, relative to the repo root
  says: The only way to the payment provider. Reserves the amount first, then charges it.   # at most 160 characters
  label: money        # money | security | core | feature | util
  deep: true          # optional: a deep module (small interface, much hidden logic)
  why: A wrong amount is charged to a real card.                  # optional, one line, at most 300
  watch: The provider retries on timeout, so a charge must be idempotent.   # optional, one line, at most 200
  start: shop/checkout/payment.py:42                              # optional: where to start reading
  mine: |                                                         # optional: your own words, at most 1500
    First reserve, then charge.
    The receipt is written last.
```

The label says why the path matters, calibrated by who gets hurt (see "Principles"):
money decides or records what someone pays; security is login, tenant separation, secrets or a door to the outside; core is the main request path and product logic; feature is a product feature docked onto that path; util is plumbing.

- The Codemap view in the Explorer is the main place to read it: the entries as a tree, each with its badge and sentence, the notes on hover, filters for money, security and deep modules.
- While you browse the code, the Explorer shows each path's badge, and its sentence on hover; a file in the codemap shows its badge and sentence above its first line (CodeLens).
- When a commit changes a path after you last confirmed its entry, the entry is marked, so you know to read it again; "Still true" clears the mark, "Explain again" writes a new explanation. Refreshing is your choice, never automatic.
- The codemap file is checked like code: every problem is in the Problems view on its line, so a path that moved is noticed at once.
- "Explain" on a file or folder opens a panel with the entry and a generated visual explanation page, if there is one.
- "Generate explanation" starts Claude Code in a terminal, which writes the page into `.codemap/explanations/<path>/` (index.html plus its images and scripts). The prompt shapes the page by the label: money shows where cost is decided and recorded and who loses money if it breaks; security shows where a secret or identity is born, lives and dies and which attack the code stops; deep shows the small interface against what it hides; core shows its place in the main request path; feature shows a real screenshot of where users see it plus 3 sentences; util is only 3 sentences.
- Unlike the review runs, the explanation run is not read-only: it may run the app and render images. So it runs visibly in a terminal, under Claude Code's normal permission prompts, and only after you pressed the button. The review runs stay read-only (S1).
- "Own it" asks whether you own an entry: write in your own words how it works (`mine`), press "Check my words", and one read-only Claude call on a clean copy of the last commit says understood, almost (with a question) or not yet (with file:line). Only that check counts; the chat next to it is a tutor whose verdicts are hints. A commit that touches the path takes "understood" away again, and the Codemap view's 3am line counts how many money and security entries you own.
- The extension itself only reads the codemap and the explanations; the pages are written by Claude Code, into the personal `.codemap` folder. Checks, chats and the copies of HEAD live in the extension's storage, never in the repo.

## God files

The owner's rule: a big file is fine only as a well-designed deep module.
So the God Files view ranks files by breadth (how many of a file's names other files use) and by reasons to change (history), never by length.

- The ranking (`src/godfiles/`, interface `measureGodFiles(repoFolder, options)`) uses no Claude, no network and no language server. Its thresholds and the area rule are in `godFileRules`. Breadth comes from the language servers VS Code already runs (`measureBreadth`), cognitive complexity from standard tools (`measureComplexity`), both for the files shown.
- The hint (`god file?`, `deep`) is a hint. "Judge with Claude" is the judgment, and it runs only when the owner asks.
- Speed: the rows within 1 s on a repo with about 2,000 source files and 3,000 commits in 90 days; breadth for the 20 rows follows as fast as the language server answers (REPORT.md).
- Not in v1: writing into the codemap, Explorer badges, opening split PRs.

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
8. For a critical unit you explain it in your own words; when Claude confirms it, the unit is "understood" (see "Ownership check").

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

The extension runs on your own machine.
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
- Per unit, optional: "worth having?" note when a change adds complexity or API surface for little gain.
- A reading order.
- "What this PR does" in 3 to 5 sentences.

### Pass 2: deep check (critical units only)

Claude may read the whole repo (read-only).
For each critical unit it looks at: the full function before and after, its callers and callees, the tests that cover it, and the reference it must match (named in the repo profile).

Output (structured JSON) per unit:
- What the code does, in plain words (2-3 sentences), so the reader understands it before judging it.
- Explanations are visual (added 2026-09-26): whenever it helps, the plain words, the questions and the chat answers include a small ASCII diagram (data flow, shapes, bit layout, before/after), and say WHY with an everyday analogy that is then mapped back to the code. Example: for `_ste(value, x): return value.detach() + (x - x.detach())`, rounding is a staircase with slope 0, so no gradient; the STE uses the rounded value forward and the slope of x backward; `x - x.detach()` is a zero that carries x's gradient; the usual form `x + (value - x).detach()` is not exact in float32 (clamp(3.7046e-05, 1e-4) gives 1.0000000475e-04 instead of 9.9999997474e-05).
- Blocking problems only: file and line, why it is wrong, and how to show that it fails (an input, a test).
- Questions for you ("Check: ..."), each tied to a line range.
- What Claude checked itself, and where it looked (e.g. "read test_packing.py: 3-bit case covered").
- What only you can check.
- Anything Claude could not confirm is marked as unconfirmed.

### Ownership check

Reading a unit does not prove that you understand it.
So every critical unit has three states: unread, read, understood.

- You write 1-2 sentences: what this code does and why it is correct.
- Claude (same read-only CLI call) compares your words with the code and answers:
  - understood: your explanation is right and covers what matters;
  - almost: right, but misses something (Claude names it, e.g. "what happens at a 3-bit word boundary");
  - not yet: something is wrong (Claude names it and points to the line).
- Claude does not give you the answer before you try; its own plain-words summary is folded until you have written yours.
- After the verdict it is a chat (added 2026-09-26): you can answer, try again or ask back ("why detach?"), as often as you need. Every turn sends the unit, the code and the conversation so far to the same read-only call; Claude answers and gives a new verdict. Its explanations do not count as your understanding: only "understood", judged on your own words, marks the unit.
- Your explanations and the whole chat are stored locally, next to the read marks, and are never sent anywhere except to your local Claude.
- When the code of an understood unit changes in a new push, it goes back to "read".

The ownership overview (per repo) sums this up per file, so you see which parts of the repo you do not own yet.

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

Without a profile, Claude uses general rules:
- critical: auth, security, money, persistence and file formats, math and numerics, public API and defaults, concurrency, weakened tests;
- check: complex logic without those risks, new tests, new dependencies;
- skim: documentation, comments, renames, formatting.
On the first PR of a repo without a profile, Claude also writes a draft profile from the code.
The extension shows the draft; you edit it and save it into the repo yourself (the extension never writes into the repo).

## Data and state

- Cache key: (repo, PR number, head commit SHA, unit hash).
  A new push re-runs only units whose hash changed.
- After a new push, units that did not change keep their state; changed units become unread (or "read" if they were understood) and are flagged "changed since your review".
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
- The owner reviews commit by commit afterwards and runs the manual checks (Q, R) at the end.
- Build order:
  1. Skeleton: GitHub login, list of PRs in the side bar.
  2. Open a PR: worktree, review units, diff on click, guide panel.
  3. Pass 1 with Claude, cache.
  4. Pass 2, read marks, limit of 25.
  5. Ownership check and ownership overview.
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

- Public on GitHub (gapsong/review-guide) since 0.4.0; the .vsix ships as a release asset, not on the Marketplace yet.
- License: MIT.
- Public users run their own local Claude Code CLI; nobody gets a login from the extension.
  Checked word for word against Claude Code's legal and compliance page (October 2026): an end user signing in to the unmodified Claude Code binary with their own subscription is allowed.
  The extension must never collect, store or pass on Claude credentials, and names Claude Code only in plain text, without Anthropic logos or anything that suggests endorsement.

## Later versions

- Post your own review comments to GitHub (button, never automatic).
- Split a large branch into small stacked PRs.
