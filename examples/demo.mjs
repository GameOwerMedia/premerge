#!/usr/bin/env node
// Demo: two agents share one working tree of "acme-shop". Each saves only its own files onto its own branch
// (no checkout, no stash), writes a premerge report, and the merging side lists both before merging.
//   node examples/demo.mjs [--keep] [--write-docs]
// --write-docs copies both generated reports to docs/example-report-*.md and the transcript to docs/example-transcript.txt.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '..', 'skills', 'premerge', 'scripts', 'premerge.mjs');
const keep = process.argv.includes('--keep'), writeDocs = process.argv.includes('--write-docs');
const root = mkdtempSync(path.join(tmpdir(), 'premerge-demo-')), repo = path.join(root, 'acme-shop');
const transcript = [];
const hide = s => s.split(root).join('~/work').split(root.replace(/\\/g, '/')).join('~/work').replace(/\\/g, '/');
const g = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();
const put = (f, t) => { mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); writeFileSync(path.join(repo, f), t); };
function step(title, args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: repo, encoding: 'utf8', env: { ...process.env, PREMERGE_REGISTRY: '' } });
  const shown = args.map(a => (/\s/.test(a) ? `"${a}"` : a)).join(' ');
  transcript.push(`$ premerge ${hide(shown)}`, hide((r.stdout + r.stderr).trim()), '');
  console.log(`\n# ${title}\n$ premerge ${hide(shown)}\n${hide((r.stdout + r.stderr).trim())}  [exit ${r.status}]`);
  return r;
}

mkdirSync(repo, { recursive: true });
g('init', '-q', '-b', 'main');
for (const [k, v] of [['user.email', 'agent@example.com'], ['user.name', 'Demo Agent'], ['core.autocrlf', 'false'], ['commit.gpgsign', 'false']]) g('config', k, v);
put('package.json', '{\n  "name": "acme-shop",\n  "version": "1.0.0"\n}\n');
put('src/cart.js', 'export function total(items) {\n  return 0;\n}\n');
put('src/checkout.js', "import { total } from './cart.js';\nexport const summary = items => `Total: ${total(items)}`;\n");
put('src/i18n.js', "export const currency = 'EUR';\n");
g('add', '.'); g('commit', '-q', '-m', 'Initial shop');

// Both agents edit the same working tree at the same time.
put('src/cart.js', 'export function total(items, { discount = 0 } = {}) {\n  const sum = items.reduce((s, i) => s + i.price * i.qty, 0);\n  return sum * (1 - discount);\n}\n');
put('package.json', '{\n  "name": "acme-shop",\n  "version": "1.1.0",\n  "scripts": { "test": "node --test" }\n}\n');
put('test/cart.test.js', "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { total } from '../src/cart.js';\ntest('total', () => assert.equal(total([{ price: 2, qty: 3 }]), 6));\n");
put('src/i18n.js', "export const currency = 'USD';\nexport const locale = 'en-US';\n");
writeFileSync(path.join(root, 'notes-a.md'), [
  '### Cart total with discounts',
  '- `src/cart.js`: `total(items, { discount })` replaces the stub; callers that pass only `items` keep working.',
  '- `test/cart.test.js`: first unit test; `package.json` gets a `test` script and the version bump to 1.1.0.',
  '- Left out on purpose: `src/i18n.js` is the other agent\'s currency change in the same working tree.',
  '- Tests: `npm test`.', ''].join('\n'));

step('Agent A saves only its own files onto agent-a/cart (working tree, index and HEAD untouched)',
  ['save', '--branch', 'agent-a/cart', '-m', 'Cart total with discounts and a first unit test', '--', 'src/cart.js', 'test/cart.test.js', 'package.json']);
// Agent B bumps the version too, after agent A saved: package.json on disk is now partly someone else's.
put('package.json', '{\n  "name": "acme-shop",\n  "version": "1.2.0",\n  "scripts": { "test": "node --test" }\n}\n');
step('Without a purpose the report is refused', ['report', '--branch', 'agent-a/cart', '--commit']);
step('Agent A writes and commits its report', ['report', '--branch', 'agent-a/cart', '--why', 'Checkout needs real totals with discounts before the spring sale.',
  '--notes', path.join(root, 'notes-a.md'), '--author', 'agent-a (cart)', '--commit']);
step('Agent B saves its currency change and reports, depending on agent A', ['save', '--branch', 'agent-b/usd', '-m', 'Sell in USD', '--', 'src/i18n.js', 'package.json']);
step('Agent B reports; its report sees the overlap with agent A', ['report', '--branch', 'agent-b/usd', '--why', 'The US store opens first, so prices are shown in USD.', '--author', 'agent-b (i18n)', '--depends-on', 'agent-a/cart', '--commit']);
step('The merging side compares every branch before merging', ['list']);
console.log(`\nWorking tree after all of this (nothing was checked out or stashed):\n${g('status', '--short')}`);
transcript.push('$ git status --short', g('status', '--short'), '');

if (writeDocs) {
  const docs = path.join(here, '..', 'docs');
  mkdirSync(docs, { recursive: true });
  for (const b of ['agent-a/cart', 'agent-b/usd']) {
    const file = `${b.replace('/', '_')}.md`;
    writeFileSync(path.join(docs, `example-report-${file}`), hide(g('show', `${b}:docs/premerge/${file}`)) + '\n');
  }
  writeFileSync(path.join(docs, 'example-transcript.txt'), transcript.join('\n'));
  console.log('\nWrote docs/example-report-*.md and docs/example-transcript.txt');
}
if (keep) console.log(`\nKept: ${repo}`); else rmSync(root, { recursive: true, force: true });
