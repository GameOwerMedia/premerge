# Premerge: `agent-a/cart`

- **Repository:** `acme-shop`
- **Why:** Checkout needs real totals with discounts before the spring sale.
- **Status:** ready
- **Merge into:** `main` (merge-base `ed2219c362`, head `0cc01d5bf3`)
- **Author:** agent-a (cart)
- **Written:** 2026-10-25T10:57:44.676Z
- **Size:** 1 commit(s), 3 file(s), +9/-3
- **Merge command:** `git merge --no-ff agent-a/cart`

## What and why (author)

### Cart total with discounts
- `src/cart.js`: `total(items, { discount })` replaces the stub; callers that pass only `items` keep working.
- `test/cart.test.js`: first unit test; `package.json` gets a `test` script and the version bump to 1.1.0.
- Left out on purpose: `src/i18n.js` is the other agent's currency change in the same working tree.
- Tests: `npm test`.

## Merge risks (generated)

**Hot files** (most branches touch these; resolve by keeping both sides):
- `package.json` (+2/-1)

**Partial files** (the working copy this branch was cut from still has other changes in them that are NOT in this branch; never take those from the working copy):
- `package.json`

## API changes in existing files (exports)

- Changed signature or body: `total`

## Files by module

**(root)**
- M `package.json` (+2/-1)

**src/**
- M `src/cart.js` (+3/-2)

**test/**
- A `test/cart.test.js` (+4)

## Commits

- 0cc01d5 2026-10-25 Cart total with discounts and a first unit test

## Checklist for the merging agent

1. Read every premerge report that lists the same files, and merge in dependency order.
2. Hot files: keep both sides; never pick one side for a whole file.
3. Derived files (lockfiles, generated manifests): regenerate after the merge instead of hand-merging.
4. Run the tests the author listed.
5. If you do not understand why a change exists, do not merge it: ask the author or the owner of the repository.

```premerge-json
{"schema":1,"tool":"premerge 0.1.0","repo":"acme-shop","branch":"agent-a/cart","base":"main","head":"0cc01d5bf3","mergeBase":"ed2219c362","author":"agent-a (cart)","why":"Checkout needs real totals with discounts before the spring sale.","status":"ready","dependsOn":[],"production":[],"at":"2026-10-25T10:57:44.676Z","files":["package.json","src/cart.js","test/cart.test.js"],"modules":["(root)","src/","test/"],"hotFiles":["package.json"],"exports":{"added":[],"removed":[],"changed":["total"]},"partial":["package.json"]}
```
