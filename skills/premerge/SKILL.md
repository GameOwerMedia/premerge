---
name: premerge
description: Write a merge report for a branch before someone else merges it, and compare all reports on the merging side. Use when an agent finishes work on a branch another agent or person will merge, when several agents share one repository or working tree, or when the user says "premerge", "write a merge report", "prepare this branch for merge" or asks in which order to merge the open branches.
argument-hint: '[--why "<purpose>"] [--branch <name>]'
---

# premerge

Many agents work in one repository at the same time. Before anything is merged, each one leaves a report on its own branch, so the agent that merges knows what was done, why, and which files collide with other branches, without guessing and without touching anyone's working tree.

The tool is one dependency-free script: `node "${CLAUDE_SKILL_DIR}/scripts/premerge.mjs"` (Node.js 20+, git 2.25+). Below it is written as `premerge`.

## Author side: the agent that did the work

1. **Put the work on its own branch.**
   - You own the working tree: commit normally on your branch.
   - The working tree is shared with other sessions (dirty files that are not yours): never `checkout`, `stash`, `reset` or `clean`. Save only your files:
     `premerge save --branch <you>/<topic> -m "<message>" -- <your files>`
     The commit is built in a temporary index on top of HEAD (or on top of the branch if it exists); the working tree, the shared index and HEAD do not change. Well-known private files (`.env` and `*.env`, `*.local.*`, key stores, SSH keys, credential files) and lines that look like credentials are refused. This check is best effort; never rely on it alone.
     `save -- .` is refused: name your own files or folders.
   - A file holds your hunks and someone else's: write a patch with only your hunks and use `premerge save --branch <b> -m "..." --patch mine.diff`.
2. **Write the notes** to a scratch file (`notes.md`), per feature: what and why, the files, the hunks in shared files, what you deliberately left out (other sessions' hunks), derived files and how to regenerate them, the tests to run. The facts (files, numbers, commits) come from git; do not retype them.
3. **Generate and commit the report:**
   `premerge report --why "<why this change exists, one sentence>" --branch <b> --notes notes.md --author "<name>" --commit [--status ready|wip] [--depends-on <b,b>]`
   - `--why` is mandatory. Without it the tool exits with code 3. The merging side must never merge a change whose purpose it does not understand, so state the goal (the user's request, the problem), not the mechanics.
   - `--commit` adds `docs/premerge/<branch>.md` to the branch as a new commit through a temporary index. If the branch is checked out in some worktree, that worktree's index and file are updated too, so `git status` stays clean there.
   - A branch that changes nothing except reports is refused (exit 4): usually the work commit itself failed. `--allow-empty` overrides.
   - Every report is also appended to a registry (`.git/premerge/registry.jsonl`, shared by all worktrees of the repository; set `PREMERGE_REGISTRY` to share one registry across repositories).
4. **Read the generated "Merge risks"**: partial files you did not expect, an overlap with another branch, a removed export. Fix the branch or the notes and run the report again (a newer report replaces the older one).
5. **Tell the user**: branch, report commit, `git merge --no-ff <branch>`, the risks in plain words. Do not push or merge unless asked.

## Merging side

1. `premerge list [--base main]` shows every unmerged branch, its report status (missing, stale, wip), its purpose and which other branches share files with it.
2. Read each report: `git show <branch>:docs/premerge/<branch-with-slashes-as-underscores>.md`. A branch without a current report: ask its author for one before merging.
3. Merge in dependency order (`depends on` in the report), one branch at a time, with real merge commits.
   - Hot files: keep both sides. Derived files (lockfiles, generated manifests): regenerate after the last merge.
   - Partial files: take only the branch version; the rest of the working copy belongs to someone else's unfinished work.
4. Run the tests each report lists. If you cannot say why a change exists, stop and ask; do not merge it on trust.

Many repositories, worktrees and dead sessions at once: use the companion skill **mergechaos**, which reads these reports.

## Report contents

Header (repository, why, status, dependencies, position against production branches, merge-base, size, merge command), the author's notes, generated risks (hot files, partial files, same files in other reports, other unmerged branches from the last 7 days touching the same files), exports added, changed and removed in existing JS/TS files, files by module, commits, a checklist, and a machine-readable `premerge-json` block (the contract other tools read). Format: `${CLAUDE_SKILL_DIR}/references/format.md`.

## Optional configuration: `.premerge.json` in the repository root

```json
{
  "base": "develop",
  "hotFiles": ["^src/routes\\.ts$", "(^|/)package\\.json$"],
  "modules": { "files": { "src/server.ts": "api" }, "dirs": [{ "prefix": "src/web/", "module": "web" }] },
  "productionBranches": "^(main|release/.*)$",
  "overlapDays": 7
}
```

## Rules

- Facts come from git through the tool; the author adds only the what and why. Never write file lists from memory.
- Never take another session's uncommitted hunks; the "Partial files" list exists to warn about exactly that.
- No secrets, no private files, no personal data in reports or notes.
- Exit codes: 0 ok, 2 usage, 3 missing `--why`, 4 nothing to report or save, 5 refused (private file, possible secret, or uncommitted edits in the report file of a checked-out branch).
