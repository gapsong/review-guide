# Review Guide

A VS Code extension that pre-sorts a GitHub pull request with Claude, so you review the critical changes first and know what to check at each one.

It does not review for you. It sorts your attention, explains the code in plain words and asks you questions; the merge stays yours. The goal is ownership: understanding what your code does again, even when an agent wrote it.

## What it does

1. **Lists the open pull requests** of your repos, after you sign in with VS Code's own GitHub login.
2. **Checks a PR out into its own folder** (a git worktree in the extension's storage). Your working copy is never touched.
3. **Splits the PR into review units**: one per changed function, method or class body, found with the document symbols of your language extensions.
4. **Pass 1 (overview)**: Claude gives every unit a tier (critical / check / skim) and one sentence why, sorted by the damage a quiet bug would do. A test change that removes an assertion, loosens a tolerance or adds a skip is always critical.
5. **Pass 2 (deep check)**: for every critical unit, Claude explains the code in plain words and writes questions for you, each tied to lines of the new code, plus what it checked (and where), what only you can check, and what it could not confirm. Above 25 critical units it asks you first.
6. **Ownership check**: for a critical unit you write what the code does and why it is correct; Claude answers "understood", "almost" (with what is missing) or "not yet" (with what is wrong). Only "understood" counts.
7. **The 3am check** in the PR header says how many critical units you understood, read, or have not read; "owned" only when all are understood. The **Ownership** view sums this up per file of the repo.

## Requirements

- VS Code 1.95 or newer.
- [Claude Code](https://claude.com/claude-code) installed and logged in (`claude` on your PATH, or set `reviewGuide.claudePath`). The extension runs your own `claude`, with your own subscription; no API key is needed.
- git.

## Install

```
npm install
npm run package
code --install-extension review-guide.vsix
```

## Settings

| Setting | Default | What it does |
|---|---|---|
| `reviewGuide.repositories` | `[]` | Repos (`owner/name`) whose open PRs are listed. The GitHub repo open in VS Code is always listed. |
| `reviewGuide.claudePath` | `claude` | Path of the Claude Code CLI. |
| `reviewGuide.model` | `claude-opus-5-5` | Model for both passes and the ownership check. |
| `reviewGuide.githubApiUrl` | `https://api.github.com` | GitHub REST API address. |

## Repo profile: `.review-guide.md`

A short file in the root of your repo that tells Claude what matters there, which the code alone cannot tell: what is critical, what the source of truth is, what to skim. It is read from the PR's base branch, so a PR cannot change its own rules. Without one, Claude uses general rules and writes a draft for you; the extension never writes into your repo.

## Safety

- Claude runs read-only: its only tools are Read, Grep and Glob. No shell, no edit, no write, no web. Project and user settings files, hooks and MCP servers are not loaded for these runs (`--restricted --strict-mcp-config`).
- PR code is never executed.
- Nothing is posted to GitHub. The GitHub token stays in VS Code's secret storage.
- Your read marks and explanations are stored locally and are only sent to your local Claude.

## Development

```
npm test          # lint, type check, unit tests, the S1 safety test (real Claude, haiku), VS Code integration tests
npm run package   # builds review-guide.vsix
```

Integration tests run in a real VS Code (downloaded into `.vscode-test/`), under `xvfb-run` when there is no display.

## License

MIT
