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
