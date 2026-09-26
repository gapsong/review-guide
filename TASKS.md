# Tasks

Checklist for the night run. One line per build step and per "Done when" criterion of SPEC.md.

## Build steps

- [x] 0. Test harness: TypeScript strict, ESLint, Mocha unit tests, VS Code integration tests under xvfb, MIT license
- [ ] 1. Skeleton: GitHub login, list of PRs in the side bar
- [ ] 2. Open a PR: worktree, review units, diff on click, guide panel
- [ ] 3. Pass 1 with Claude, cache
- [ ] 4. Pass 2, read marks, limit of 25
- [ ] 5. Ownership check and ownership overview

## Done when (automated)

- [ ] F1 sign in with the VS Code GitHub login, list open PRs of the configured repos
- [ ] F2 opening a PR checks out its head into a separate worktree; working copy unchanged
- [ ] F3 every review unit gets a tier and one sentence why
- [ ] F4 every critical unit gets at least one question tied to a line range in the new code
- [ ] F5 clicking a unit opens the diff at that unit; guide panel shows tier, reason, questions
- [ ] F6 read marks survive a restart of VS Code
- [ ] F7 second run on the same head commit does not call Claude again
- [ ] F8 more than 25 critical units: pass 2 waits for the user's agreement
- [ ] F9 `npm run package` builds a .vsix that installs in VS Code
- [ ] F10 lint, type check and all tests pass in `npm test`
- [ ] F11 ownership check: understood / almost / not yet; only "understood" marks understood
- [ ] F12 ownership overview per file across all PRs of a repo
- [ ] F13 weakened test (removed assert, looser tolerance, new skip) is critical
- [ ] F14 PR header shows the 3am check; "owned" only when all critical units are understood
- [ ] S1 Claude cannot change a file, start a shell or reach the web

## Manual (measured once, reported)

- [ ] Q1 gold list units are critical on gapsong/qpeft PR (main...develop at 4369298)
- [ ] Q2 at most 10 non-gold units are critical
- [ ] Q3 overview within 2 minutes

## Found along the way
