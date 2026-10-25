# Premerge: `agent-b/usd`

- **Repository:** `acme-shop`
- **Why:** The US store opens first, so prices are shown in USD.
- **Status:** ready, depends on `agent-a/cart` (merge those first)
- **Merge into:** `main` (merge-base `8d93f748f5`, head `b2e124c5ba`)
- **Author:** agent-b (i18n)
- **Written:** 2026-10-25T11:30:19.358Z
- **Size:** 1 commit(s), 2 file(s), +4/-2
- **Merge command:** `git merge --no-ff agent-b/usd`

## What and why (author)

_The author did not add notes. Read the commit messages below._

## Merge risks (generated)

**Hot files** (most branches touch these; resolve by keeping both sides):
- `package.json` (+2/-1)

**Same files in other premerge reports:**
- `agent-a/cart` (agent-a (cart)): `package.json`

**Other unmerged branches touching the same files:**
- `agent-a/cart`: `package.json`

## API changes in existing files (exports)

- Added: `locale`
- Changed signature or body: `currency`

## Files by module

**(root)**
- M `package.json` (+2/-1)

**src/**
- M `src/i18n.js` (+2/-1)

## Commits

- b2e124c 2026-10-25 Sell in USD

## Checklist for the merging agent

1. Read every premerge report that lists the same files, and merge in dependency order.
2. Hot files: keep both sides; never pick one side for a whole file.
3. Derived files (lockfiles, generated manifests): regenerate after the merge instead of hand-merging.
4. Run the tests the author listed.
5. If you do not understand why a change exists, do not merge it: ask the author or the owner of the repository.

```premerge-json
{"schema":1,"tool":"premerge 0.1.0","repo":"acme-shop","branch":"agent-b/usd","base":"main","head":"b2e124c5ba","mergeBase":"8d93f748f5","author":"agent-b (i18n)","why":"The US store opens first, so prices are shown in USD.","status":"ready","dependsOn":["agent-a/cart"],"production":[],"at":"2026-10-25T11:30:19.358Z","files":["package.json","src/i18n.js"],"modules":["(root)","src/"],"hotFiles":["package.json"],"exports":{"added":["locale"],"removed":[],"changed":["currency"]},"partial":[]}
```
