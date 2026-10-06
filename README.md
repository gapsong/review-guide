<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/review-guide-logo-dark.png">
    <img alt="Review Guide" src="docs/assets/review-guide-logo-light.png" width="520">
  </picture>
</h1>

<h3 align="center">A VS Code extension that pre-sorts a pull request with Claude, so you read the critical changes first and own your code again.</h3>

<p align="center">
  <img alt="VS Code" src="https://img.shields.io/badge/VS%20Code-%E2%89%A51.95-007ACC?logo=visualstudiocode&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white">
  <img alt="Claude Code" src="https://img.shields.io/badge/runs%20on-your%20Claude%20Code-D97757">
  <img alt="read-only" src="https://img.shields.io/badge/Claude-read--only-6366f1">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-ec4899">
  <img alt="status" src="https://img.shields.io/badge/status-alpha-lightgrey">
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#safety">Safety</a> ·
  <a href="SPEC.md">Spec</a>
</p>

Review Guide does not review for you.
It sorts your attention, explains the code in plain words and asks you questions; the merge stays yours.
Its goal is ownership: understanding what your code does again, even when an agent wrote it.

---

## Why this exists

Agents write code faster than anyone can read it.
The pressure moved from writing to reviewing, and the easy failure is to believe you reviewed carefully while you only skimmed.
Addy Osmani describes the loop that sorts his pull requests like this: "The loop doesn't merge anything. It sorts my attention, and the merge stays mine." ([Agentic Engineering](https://www.oreilly.com/library/view/agentic-engineering/0642572392291/), chapter 1)

GitHub shows a pull request as a flat list of files.
Review Guide turns it into a reading order:

- **critical first**, sorted by the damage a quiet bug would do, not by how hard the code looks;
- **questions for you** at the lines that matter, with what Claude checked and where it looked;
- **a check that you understood**, not only that you scrolled past.

## How it works

```
 GitHub PR ──► own worktree ──► review units ──► pass 1: tier + why ──► pass 2: questions ──► you
               (your working    (one per changed   (critical / check /     (critical units:       explain it,
                copy untouched)  function)          skim, cached)           plain words, lines,    chat with Claude
                                                                            what to check)         until "understood"
```

1. **Lists the open pull requests** of your repos, after you sign in with VS Code's own GitHub login.
2. **Checks a PR out into its own folder** (a git worktree in the extension's storage).
   Your working copy is never touched.
3. **Splits the PR into review units**: one per changed function, method or class body, found with the document symbols of your language extensions.
4. **Pass 1 (overview)**: Claude gives every unit a tier (critical / check / skim) and one sentence why.
   A test change that removes an assertion, loosens a tolerance or adds a skip is always critical: the agent must not grade its own work.
5. **Pass 2 (deep check)**: for every critical unit, Claude explains the code in plain words, with an ASCII diagram and an everyday analogy where that helps, and writes questions for you, each tied to lines of the new code.
   It lists what it checked (and where), what only you can check, and what it could not confirm.
   Above 25 critical units it asks you first.
6. **Ownership check**: for a critical unit you write what the code does and why it is correct.
   Claude answers "understood", "almost" (with what is missing) or "not yet" (with what is wrong), and you can reply and ask back until it clicks.
   Claude's own summary stays folded until you have tried: reading an answer is not understanding it.
7. **The 3am check** in the PR header says how many critical units you understood, read, or have not read; "owned" only when all are understood.
   The **Ownership** view sums this up per file of the repo.

## Quickstart

Review Guide is not on the Marketplace yet; build it from source.

Requirements:

- VS Code 1.95 or newer, git, Node.js 22 or newer.
- [Claude Code](https://claude.com/claude-code) installed and logged in.
  The extension runs your own `claude` with your own subscription; no API key is needed.

```
git clone https://github.com/gapsong/review-guide
cd review-guide
npm install
npm run package
code --install-extension review-guide.vsix
```

Then, in VS Code:

1. Open a folder of a GitHub repo and click **Review Guide** in the activity bar.
2. Allow the GitHub login once.
3. Open a pull request, wait for the overview, and start at the top of **Critical**.

If VS Code cannot find `claude` (common when VS Code is started from the Dock), set `reviewGuide.claudePath` to the full path, e.g. `~/.local/bin/claude`.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `reviewGuide.repositories` | `[]` | Repos (`owner/name`) whose open PRs are listed. The GitHub repo open in VS Code is always listed. |
| `reviewGuide.claudePath` | `claude` | Path of the Claude Code CLI. |
| `reviewGuide.model` | `claude-opus-5-5` | Model for both passes and the ownership check. |
| `reviewGuide.githubApiUrl` | `https://api.github.com` | GitHub REST API address. |

## Repo profile: `.review-guide.md`

A short file in the root of your repo that tells Claude what matters there, which the code alone cannot tell: what is critical, what the source of truth is, what to skim.

```markdown
## Critical
- Quantization formula, STE, packing layout, merge fold
- Save / load format, config defaults

## Source of truth
- The official implementation and the paper's formulas

## Skim
- Docstrings, log messages, README
```

It is read from the PR's base branch, so a PR cannot change its own rules.
Without one, Claude uses general rules and writes a draft for you; the extension never writes into your repo.

## Safety

- Claude runs read-only: its only tools are Read, Grep and Glob.
  No shell, no edit, no write, no web.
  Project and user settings files, hooks and MCP servers are not loaded for these runs (`--restricted --strict-mcp-config`).
  An automated test (S1) asks Claude to edit a file, run a shell command and fetch a URL, and checks that the repo stays byte for byte the same.
- Claude gets no shell, not even for git: `git log --output=<file>` can write files.
  The extension runs git itself and hands Claude the output as files to read.
- PR code is never executed.
- Nothing is posted to GitHub.
  The GitHub token stays in VS Code's secret storage.
- Everything Claude writes is escaped before it is shown; the panel renders Markdown without passing any HTML through.
- Your read marks and explanations are stored locally and are only sent to your local Claude.

## Development

```
npm test          # lint, type check, unit tests, the S1 safety test (real Claude, haiku),
                  # VS Code integration tests, the .vsix package test
npm run package   # builds review-guide.vsix
```

Integration tests run in a real VS Code downloaded into `.vscode-test/`, under `xvfb-run` when there is no display.
They run on Linux and macOS.

[SPEC.md](SPEC.md) is the contract: the goal, every done criterion (F1-F16, S1, Q1-Q3, R1) and the code style.
[REPORT.md](REPORT.md) says which test proves which criterion, and [DECISIONS.md](DECISIONS.md) records the choices the spec left open.

## Status

Alpha, built for one person's reviews first.
All automated criteria pass.
On the first real test PR (3,400 lines), every change on the reviewer's gold list was tiered critical and the overview arrived after 75 s.
Too many other changes were tiered critical as well (25, target at most 10); the repo profile is the place to tune that.

## License

MIT
