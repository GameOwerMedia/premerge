# premerge file format (schema 1)

A premerge report is a Markdown file committed on the branch it describes, at `docs/premerge/<slug>.md`, where `<slug>` is the branch name with every character outside `A-Z a-z 0-9 . _ -` replaced by `_` (`agent-a/cart` becomes `agent-a_cart`). The report travels with its branch: after the merge, `docs/premerge/` in the base branch is the history of who changed what and why.

People read the Markdown. Tools read the last fenced block, whose info string is `premerge-json`:

````
```premerge-json
{"schema":1,"tool":"premerge 0.1.0","repo":"acme-shop","branch":"agent-a/cart", ...}
```
````

## Fields

| Field | Type | Meaning |
|---|---|---|
| `schema` | number | Format version. This document describes `1`. |
| `tool` | string | Writer and version, for example `premerge 0.1.0`. |
| `repo` | string | Repository name (folder of the main worktree). Never an absolute path, so a pushed report reveals nothing about the author's machine. |
| `branch` | string | The branch the report describes. |
| `base` | string | The branch it should be merged into. |
| `head` | string | Abbreviated commit of the branch tip that the report describes (before the report commit itself). |
| `mergeBase` | string | Abbreviated merge-base of `base` and `branch`. |
| `author` | string | Who did the work. `reconstructed` marks a report written later from commits by someone else. |
| `why` | string | Why the change exists, one sentence. Required: the writer refuses to produce a report without it. |
| `status` | string | `ready` or `wip`. |
| `dependsOn` | string[] | Branches that must be merged first. |
| `production` | object[] | `{ branch, ahead, behind }` against production-like branches other than the base. |
| `at` | string | ISO 8601 time the report was written. |
| `files` | string[] | Every file the branch changes against the merge-base (including report files). |
| `modules` | string[] | Owning modules of those files. |
| `hotFiles` | string[] | Files that most branches touch (lockfiles, configs, routes, migrations, CI). |
| `exports` | object | `{ added, changed, removed }` exported names in modified JS/TS files. |
| `partial` | string[] | Files whose working copy still held other, uncommitted changes when the report was written. |

Readers must ignore unknown fields, so later versions can add fields without breaking older tools.

## When is a report current?

A report describes `head`. It is current when `head` is an ancestor of the branch tip and every commit after `head` only touches files under `docs/premerge/`. The report's own commit therefore never makes it stale, but any later work does.

## Registry

Each report is also appended as one JSON line (the fields above plus `repoPath` and `file`) to `registry.jsonl` in:

- `<git common dir>/premerge/` by default, shared by every worktree of the repository and never committed;
- `$PREMERGE_REGISTRY` when set, to share one registry across repositories on one machine.

The newest line per `repo` and `branch` wins.
