#!/usr/bin/env node
// premerge: a merge report for one branch, written by the agent that did the work and read by the agent that merges.
//
// The facts come from git (files, modules, exports, commits, overlaps with other branches and their reports);
// the author adds only the "what and why". The report is committed onto the branch through a temporary index,
// so the shared working tree is never checked out, stashed or reset.
//
// Commands:
//   premerge.mjs report --why "<one sentence>" [--branch <b>] [--base <b>] [--notes <file.md>] [--author <name>]
//                       [--status ready|wip] [--depends-on <b,b>] [--commit] [--allow-empty] [--repo <dir>]
//                       [--registry <dir>] [--no-registry] [--out <file>] [--json]
//   premerge.mjs save   --branch <b> -m "<message>" [--from <ref>] [--patch <file.diff>] [--repo <dir>] [--] <paths...>
//   premerge.mjs list   [--base <b>] [--repo <dir>] [--json]
//
// "report" is the default command, so `premerge.mjs --why "..." --commit` works too.
// Exit codes: 0 ok, 2 usage error, 3 missing --why, 4 nothing to report or save, 5 refused (secret or private file).
// No dependencies: Node.js 18+ and git 2.31+.
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERSION = '0.1.0';
export const REPORT_DIR = 'docs/premerge';
export const MARKER = 'premerge-json';
export const SCHEMA = 1;

/** Files that almost every branch touches. A conflict is most likely here, so the merging agent looks at them first. */
export const DEFAULT_HOT_FILES = [
  '(^|/)package(-lock)?\\.json$', '(^|/)(pnpm-lock\\.yaml|yarn\\.lock|bun\\.lockb?|Cargo\\.lock|go\\.sum|poetry\\.lock|uv\\.lock|Gemfile\\.lock|composer\\.lock)$',
  '(^|/)(requirements[^/]*\\.txt|pyproject\\.toml|go\\.mod|Cargo\\.toml|Gemfile|composer\\.json)$',
  '(^|/)(next|vite|tailwind|webpack|rollup|astro|nuxt|svelte|postcss|eslint|vitest|jest|playwright)\\.config\\.\\w+$', '(^|/)tsconfig[^/]*\\.json$',
  '(^|/)globals?\\.(css|scss)$', '(^|/)schema\\.(prisma|sql|graphql)$', '(^|/)migrations?/', '(^|/)(middleware|routes?|router)\\.\\w+$',
  '^\\.env\\.example$', '^\\.gitignore$', '^\\.gitattributes$', '^\\.github/workflows/', '(^|/)Dockerfile$', '(^|/)docker-compose[^/]*\\.ya?ml$', '^Makefile$',
];
const PROD_PATTERN = '^(prod|production|release)([-_/].*)?$|^(main|master)$';
const BASE_CANDIDATES = ['main', 'master', 'trunk', 'develop'];
/** Never committed by `save`, whatever the caller asks. */
export const PRIVATE_FILE = /(^|\/)(\.env(\.[^/]*)?|[^/]*\.local\.[^/]+|[^/]*\.(pem|key|p12|pfx)|id_(rsa|dsa|ecdsa|ed25519)|\.npmrc|\.pypirc|\.netrc|credentials[^/]*\.json)$/i;
const ENV_EXAMPLE = /(^|\/)\.env\.(example|sample|template)$/i;

// ---------- git ----------

export function git(repo, args, { env, input, allowFail = false } = {}) {
  const r = spawnSync('git', args, { cwd: repo, env: env || process.env, input, encoding: 'utf8', maxBuffer: 256 << 20, windowsHide: true });
  if (r.status !== 0) {
    if (allowFail) return null;
    throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || r.stdout || '').trim()}`);
  }
  return r.stdout.replace(/\s+$/, '');
}
const lines = s => (s ? s.split('\n').filter(Boolean) : []);
const isAncestor = (repo, a, b) => spawnSync('git', ['merge-base', '--is-ancestor', a, b], { cwd: repo, windowsHide: true }).status === 0;
const refExists = (repo, ref) => git(repo, ['rev-parse', '--verify', '-q', ref], { allowFail: true }) !== null;
const real = p => { try { return realpathSync.native(p); } catch { return path.resolve(p); } };
export const samePath = (a, b) => {
  const n = p => real(p).replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b);
};
export const toplevel = dir => git(dir, ['rev-parse', '--show-toplevel']);
/** Directory that holds the shared .git of all worktrees of this repository. */
export const commonDir = repo => path.resolve(repo, git(repo, ['rev-parse', '--git-common-dir']));
/** Name of the repository: folder of the main worktree, also when called from a linked worktree. */
export function repoName(repo) {
  const c = commonDir(repo);
  return path.basename(path.basename(c) === '.git' ? path.dirname(c) : c.replace(/\.git$/, ''));
}
export const slug = branch => branch.replace(/[^A-Za-z0-9._-]+/g, '_');

/** Worktrees of the repository with the branch each has checked out. */
export function worktrees(repo) {
  const out = []; let cur = null;
  for (const l of (git(repo, ['worktree', 'list', '--porcelain']) || '').split('\n').concat([''])) {
    if (l.startsWith('worktree ')) cur = { path: l.slice(9), branch: null };
    else if (cur && l.startsWith('branch ')) cur.branch = l.slice(7).replace(/^refs\/heads\//, '');
    else if (cur && l === 'detached') cur.detached = true;
    else if (cur && l === 'bare') cur.bare = true;
    else if (!l && cur) { out.push(cur); cur = null; }
  }
  return out;
}
export const worktreeOf = (repo, branch) => worktrees(repo).find(w => w.branch === branch && !w.bare && existsSync(w.path)) || null;

// ---------- arguments and configuration ----------

const BOOLEAN = new Set(['commit', 'json', 'allow-empty', 'no-registry', 'help', 'version']);
export function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { o._.push(...argv.slice(i + 1)); break; }
    if (a === '-m') { o.message = argv[++i]; continue; }
    if (a === '-h') { o.help = true; continue; }
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const eq = a.indexOf('=');
    const key = (eq > 0 ? a.slice(2, eq) : a.slice(2));
    if (eq > 0) o[key] = a.slice(eq + 1);
    else if (BOOLEAN.has(key)) o[key] = true;
    else o[key] = argv[++i];
  }
  return o;
}

/** Optional per-repo configuration in `.premerge.json` (read from the branch, then from the working tree). */
export function loadConfig(repo, ref) {
  const raw = (ref && git(repo, ['show', `${ref}:.premerge.json`], { allowFail: true })) ?? (existsSync(path.join(repo, '.premerge.json')) ? readFileSync(path.join(repo, '.premerge.json'), 'utf8') : null);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { throw new Error(`.premerge.json is not valid JSON: ${e.message}`); }
}

/** Branch the work will be merged into: config, origin/HEAD, then the usual names. */
export function defaultBase(repo, config = {}) {
  if (config.base && refExists(repo, `refs/heads/${config.base}`)) return config.base;
  const origin = git(repo, ['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD'], { allowFail: true });
  if (origin) { const b = origin.replace(/^origin\//, ''); if (refExists(repo, `refs/heads/${b}`)) return b; }
  for (const b of BASE_CANDIDATES) if (refExists(repo, `refs/heads/${b}`)) return b;
  return 'HEAD';
}

/** Position of the branch against production-like branches (commits ahead, behind). */
export function againstProduction(repo, branch, { base = null, pattern = PROD_PATTERN } = {}) {
  const re = new RegExp(pattern || PROD_PATTERN);
  return lines(git(repo, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])).filter(b => b !== branch && b !== base && re.test(b)).map(b => {
    const [behind, ahead] = git(repo, ['rev-list', '--left-right', '--count', `${b}...${branch}`]).split(/\s+/).map(Number);
    return { branch: b, ahead, behind };
  });
}

// ---------- report data ----------

/** The machine-readable block at the end of a report. */
export function reportJson(md) {
  const m = String(md || '').match(new RegExp('```' + MARKER + '\\r?\\n([\\s\\S]*?)\\r?\\n```'));
  try { return m ? JSON.parse(m[1]) : null; } catch { return null; }
}

/** Owning module of a file: explicit file entry, longest directory prefix, else the top-level folder. */
export function moduleOf(file, map) {
  if (map?.files?.[file]) return map.files[file];
  const d = (map?.dirs || []).filter(x => file.startsWith(x.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0];
  if (d) return d.module;
  return file.includes('/') ? file.split('/')[0] + '/' : '(root)';
}

/** Exported names added, removed and changed in a unified diff (JS and TS). */
export function exportsFromDiff(diff) {
  const added = new Set(), removed = new Set();
  for (const l of String(diff).split('\n')) {
    const m = l.match(/^([+-])(?![+-])\s*export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum|abstract\s+class)\s+([A-Za-z0-9_$]+)/);
    if (m) (m[1] === '+' ? added : removed).add(m[2]);
  }
  return { added: [...added].filter(x => !removed.has(x)), removed: [...removed].filter(x => !added.has(x)), changed: [...added].filter(x => removed.has(x)) };
}

/** Reports saved as files in a folder (docs/premerge of a working copy), except the branch's own one. */
export function reportsInDir(dir, branch) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'README.md' && f !== `${slug(branch)}.md`).flatMap(f => {
    const j = reportJson(readFileSync(path.join(dir, f), 'utf8'));
    return j ? [j] : [];
  });
}

/** Reports committed on other unmerged local branches (each branch carries its own docs/premerge/<slug>.md). */
export function reportsOnBranches(repo, { base, exclude } = {}) {
  const out = [];
  for (const b of lines(git(repo, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']))) {
    if (b === exclude || b === base || (base && isAncestor(repo, b, base))) continue;
    const j = reportJson(git(repo, ['show', `refs/heads/${b}:${REPORT_DIR}/${slug(b)}.md`], { allowFail: true }));
    if (j) out.push({ ...j, source: `branch ${b}` });
  }
  return out;
}

/** Registry: one JSON line per report, shared by all worktrees (inside .git) or by many repos (PREMERGE_REGISTRY). */
export function registryDir(repo, override) {
  return override || process.env.PREMERGE_REGISTRY || path.join(commonDir(repo), 'premerge');
}
export function appendRegistry(md, dir, { repoPath } = {}) {
  const j = reportJson(md);
  if (!j) return null;
  const file = path.join(dir, slug(j.repo || 'repo'), `${slug(j.branch)}.md`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, md);
  appendFileSync(path.join(dir, 'registry.jsonl'), JSON.stringify({ ...j, repoPath: repoPath ? repoPath.replace(/\\/g, '/') : undefined, file: file.replace(/\\/g, '/') }) + '\n');
  return file.replace(/\\/g, '/');
}
/** Newest registry row per repo and branch (a later line wins). */
export function readRegistry(dir) {
  const m = new Map();
  let t = ''; try { t = readFileSync(path.join(dir, 'registry.jsonl'), 'utf8'); } catch { return []; }
  for (const l of t.split('\n')) { try { const j = JSON.parse(l); m.set(`${j.repo}|${j.branch}`, j); } catch { /* torn line */ } }
  return [...m.values()];
}

/** Registry rows that belong to this repository (same name and, when recorded, the same .git folder). */
export function registryFor(repo, dir) {
  const name = repoName(repo), cd = commonDir(repo);
  return readRegistry(dir).filter(r => r.repo === name && (!r.repoPath || samePath(r.repoPath, cd)));
}

/** A report is current when every commit after the head it describes only touches report files. */
export function reportIsCurrent(repo, branch, head) {
  if (!head || !refExists(repo, `${head}^{commit}`)) return false;
  if (!isAncestor(repo, head, branch)) return false;
  return lines(git(repo, ['diff', '--name-only', '--no-renames', head, branch])).every(f => f.startsWith(`${REPORT_DIR}/`));
}

/** Facts about the branch, from git only. */
export function collect(repo, { branch, base, config = {} }) {
  const mb = git(repo, ['merge-base', base, branch]);
  const commits = lines(git(repo, ['log', '--format=%h %ad %s', '--date=short', `${mb}..${branch}`]));
  const numstat = lines(git(repo, ['diff', '--numstat', '--no-renames', mb, branch])).map(l => { const [a, d, p] = l.split('\t'); return { file: p, added: +a || 0, removed: +d || 0 }; });
  const status = Object.fromEntries(lines(git(repo, ['diff', '--name-status', '--no-renames', mb, branch])).map(l => { const [s, p] = l.split('\t'); return [p, s[0]]; }));
  const hot = (config.hotFiles || DEFAULT_HOT_FILES).map(r => new RegExp(r));
  const files = numstat.map(s => ({ ...s, status: status[s.file] || 'M', module: moduleOf(s.file, config.modules), hot: hot.some(r => r.test(s.file)) }));
  const code = files.filter(f => /\.(m?[jt]sx?|cjs|cts)$/.test(f.file) && f.status === 'M').map(f => f.file);
  const exportsChanged = exportsFromDiff(code.length ? git(repo, ['diff', mb, branch, '--', ...code]) : '');
  // Partial files: the branch was cut from this working copy (HEAD is the branch or one of its ancestors), but the copy
  // still holds other changes in files the branch touches. Those changes belong to someone else and are NOT in the branch.
  const head = git(repo, ['rev-parse', 'HEAD'], { allowFail: true });
  const partialChecked = !!head && isAncestor(repo, head, branch);
  const partial = !partialChecked ? [] : files.filter(f => f.status !== 'D' && !f.file.startsWith(`${REPORT_DIR}/`)).map(f => f.file).filter(p => {
    const onDisk = path.join(repo, p);
    if (!existsSync(onDisk) || statSync(onDisk).isDirectory()) return false;
    const want = git(repo, ['rev-parse', `${branch}:${p}`], { allowFail: true });
    const disk = git(repo, ['hash-object', '--', p], { allowFail: true });
    // equal to HEAD means the copy simply does not have the branch's change yet: not partial
    return disk !== want && disk !== git(repo, ['rev-parse', `HEAD:${p}`], { allowFail: true });
  });
  return { repo: repoName(repo), branch, base, mergeBase: mb.slice(0, 10), head: git(repo, ['rev-parse', '--short=10', branch]), commits, files, exports: exportsChanged, partial, partialChecked };
}

/** Other unmerged branches (committed to in the last `days`) that change some of the same files. */
export function overlappingBranches(repo, { branch, base, files, days = 7 }) {
  const mine = new Set(files.map(f => f.file).filter(f => !f.startsWith(`${REPORT_DIR}/`))), since = Date.now() - days * 864e5, out = [];
  for (const l of lines(git(repo, ['for-each-ref', '--format=%(refname:short) %(committerdate:unix)', 'refs/heads']))) {
    const [b, t] = l.split(' ');
    if (b === branch || b === base || +t * 1000 < since || isAncestor(repo, b, base)) continue;
    const shared = lines(git(repo, ['diff', '--name-only', '--no-renames', `${base}...${b}`], { allowFail: true }) || '').filter(p => mine.has(p));
    if (shared.length) out.push({ branch: b, files: shared });
  }
  return out.sort((a, b) => b.files.length - a.files.length);
}

const code = s => `\`${s}\``;

/** The report: Markdown for people, a JSON block for tools. */
export function renderReport(f, { notes = '', author = '', why = '', status = 'ready', dependsOn = [], production = [], others = [], overlaps = [], now = new Date() } = {}) {
  const byModule = {};
  for (const p of f.files) (byModule[p.module] ||= []).push(p);
  const hot = f.files.filter(p => p.hot);
  const fromReports = others.map(r => ({ branch: r.branch, author: r.author, shared: (r.files || []).filter(p => !p.startsWith(`${REPORT_DIR}/`) && f.files.some(x => x.file === p)) })).filter(r => r.shared.length);
  const json = { schema: SCHEMA, tool: `premerge ${VERSION}`, repo: f.repo, branch: f.branch, base: f.base, head: f.head, mergeBase: f.mergeBase, author, why, status, dependsOn, production, at: now.toISOString(),
    files: f.files.map(p => p.file), modules: Object.keys(byModule), hotFiles: hot.map(p => p.file), exports: f.exports, partial: f.partial };
  const s = [];
  s.push(`# Premerge: ${code(f.branch)}`, '');
  s.push(`- **Repository:** ${code(f.repo)}`, `- **Why:** ${why || '(not given)'}`,
    `- **Status:** ${status}${dependsOn.length ? `, depends on ${dependsOn.map(code).join(', ')} (merge those first)` : ''}`,
    ...(production.length ? [`- **Against production:** ${production.map(p => `${code(p.branch)} ${p.ahead} ahead / ${p.behind} behind`).join('; ')}`] : []),
    `- **Merge into:** ${code(f.base)} (merge-base ${code(f.mergeBase)}, head ${code(f.head)})`, `- **Author:** ${author || '(not given)'}`, `- **Written:** ${now.toISOString()}`,
    `- **Size:** ${f.commits.length} commit(s), ${f.files.length} file(s), +${f.files.reduce((a, p) => a + p.added, 0)}/-${f.files.reduce((a, p) => a + p.removed, 0)}`,
    `- **Merge command:** ${code(`git merge --no-ff ${f.branch}`)}`, '');
  s.push('## What and why (author)', '', notes.trim() || '_The author did not add notes. Read the commit messages below._', '');
  s.push('## Merge risks (generated)', '');
  if (hot.length) s.push('**Hot files** (most branches touch these; resolve by keeping both sides):', ...hot.map(p => `- ${code(p.file)} (+${p.added}/-${p.removed})`), '');
  if (f.partial.length) s.push('**Partial files** (the working copy this branch was cut from still has other changes in them that are NOT in this branch; never take those from the working copy):', ...f.partial.map(p => `- ${code(p)}`), '');
  if (fromReports.length) s.push('**Same files in other premerge reports:**', ...fromReports.map(r => `- ${code(r.branch)} (${r.author || '?'}): ${r.shared.map(code).join(', ')}`), '');
  if (overlaps.length) s.push('**Other unmerged branches touching the same files:**', ...overlaps.slice(0, 15).map(n => `- ${code(n.branch)}: ${n.files.slice(0, 8).map(code).join(', ')}${n.files.length > 8 ? ` +${n.files.length - 8}` : ''}`), '');
  if (!hot.length && !f.partial.length && !fromReports.length && !overlaps.length) s.push('No overlaps found.', '');
  if (!f.partialChecked) s.push('_Partial-file check skipped: this working copy has an unrelated commit checked out, so its files say nothing about this branch._', '');
  const e = f.exports;
  if (e.added.length || e.removed.length || e.changed.length) {
    s.push('## API changes in existing files (exports)', '');
    if (e.added.length) s.push(`- Added: ${e.added.map(code).join(', ')}`);
    if (e.changed.length) s.push(`- Changed signature or body: ${e.changed.map(code).join(', ')}`);
    if (e.removed.length) s.push(`- **Removed (check callers):** ${e.removed.map(code).join(', ')}`);
    s.push('');
  }
  s.push('## Files by module', '');
  for (const [m, ps] of Object.entries(byModule).sort()) {
    s.push(`**${m}**`);
    const fresh = ps.filter(p => p.status === 'A'), rest = ps.filter(p => p.status !== 'A');
    for (const p of rest) s.push(`- ${p.status} ${code(p.file)} (+${p.added}/-${p.removed})`);
    if (fresh.length > 6 && fresh.every(p => path.posix.dirname(p.file) === path.posix.dirname(fresh[0].file))) s.push(`- A ${code(path.posix.dirname(fresh[0].file) + '/')} (${fresh.length} new files)`);
    else for (const p of fresh) s.push(`- A ${code(p.file)} (+${p.added})`);
    s.push('');
  }
  s.push('## Commits', '', ...f.commits.map(c => `- ${c}`), '');
  s.push('## Checklist for the merging agent', '',
    '1. Read every premerge report that lists the same files, and merge in dependency order.',
    '2. Hot files: keep both sides; never pick one side for a whole file.',
    '3. Derived files (lockfiles, generated manifests): regenerate after the merge instead of hand-merging.',
    '4. Run the tests the author listed.',
    '5. If you do not understand why a change exists, do not merge it: ask the author or the owner of the repository.', '');
  s.push('```' + MARKER, JSON.stringify(json), '```', '');
  return s.join('\n');
}

// ---------- writing to branches without touching the working tree ----------

function withTempIndex(repo, label, fn) {
  const idx = path.join(path.resolve(repo, git(repo, ['rev-parse', '--git-dir'])), `premerge-${process.pid}-${slug(label)}.idx`);
  try { return fn({ ...process.env, GIT_INDEX_FILE: idx }); } finally { rmSync(idx, { force: true }); }
}

/** Keeps the worktree that has `branch` checked out in step after its ref moved: file on disk and index entry. */
function syncCheckedOut(repo, branch, relPath, blob, content) {
  const wt = worktreeOf(repo, branch);
  if (!wt) return null;
  mkdirSync(path.dirname(path.join(wt.path, relPath)), { recursive: true });
  writeFileSync(path.join(wt.path, relPath), content);
  git(wt.path, ['update-index', '--add', '--cacheinfo', `100644,${blob},${relPath}`]);
  git(wt.path, ['update-index', '-q', '--refresh'], { allowFail: true });
  return wt.path;
}

/** Adds one file to the tip of `branch` as a new commit, through a temporary index. No checkout, no stash. */
export function commitFileToBranch(repo, branch, relPath, content, message) {
  return withTempIndex(repo, branch, env => {
    const old = git(repo, ['rev-parse', `refs/heads/${branch}`]);
    git(repo, ['read-tree', old], { env });
    const blob = git(repo, ['hash-object', '-w', '--stdin'], { input: content });
    git(repo, ['update-index', '--add', '--cacheinfo', `100644,${blob},${relPath}`], { env });
    const tree = git(repo, ['write-tree'], { env });
    const c = git(repo, ['commit-tree', tree, '-p', old], { input: message });
    git(repo, ['update-ref', '-m', `premerge: ${relPath}`, `refs/heads/${branch}`, c, old]);
    syncCheckedOut(repo, branch, relPath, blob, content);
    return c;
  });
}

const SECRET_RULES = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['provider key', /\b(sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|hf_[A-Za-z0-9]{30,}|glpat-[A-Za-z0-9_-]{20,})\b/],
  ['assigned secret', /\b(api[_-]?key|secret|token|password|passwd|client[_-]?secret)\b["']?\s*[:=]\s*["'][^"'\s]{12,}["']/i],
];
/** Secret-like lines added by a diff: kinds and file names only, never the values. */
export function scanDiffForSecrets(diff) {
  const hits = []; let file = null;
  for (const l of String(diff).split('\n')) {
    if (l.startsWith('+++ ')) { file = l.slice(4).replace(/^b\//, ''); continue; }
    if (!l.startsWith('+') || l.startsWith('+++')) continue;
    for (const [kind, re] of SECRET_RULES) if (re.test(l)) hits.push({ kind, file });
  }
  return hits;
}

/**
 * Saves chosen files from the working tree onto `branch` without touching the working tree, the shared index or HEAD.
 * The new commit's parent is the branch tip (or `from`, HEAD by default, when the branch does not exist yet).
 * `patch` stages only the hunks in that diff, for files that also hold other people's changes.
 */
export function saveWork(repo, { branch, message, paths = [], from = 'HEAD', patch = null }) {
  if (!branch) throw usage('save needs --branch <name>');
  if (!message) throw usage('save needs -m "<message>"');
  if (!paths.length && !patch) throw usage('save needs the paths to save (after --) or --patch <file>');
  const exists = refExists(repo, `refs/heads/${branch}`);
  if (exists && worktreeOf(repo, branch)) throw usage(`branch ${branch} is checked out in ${worktreeOf(repo, branch).path}; commit there with plain git instead`);
  const rel = paths.map(p => path.relative(repo, path.resolve(repo, p)).replace(/\\/g, '/'));
  const priv = rel.filter(p => PRIVATE_FILE.test(p) && !ENV_EXAMPLE.test(p));
  if (priv.length) return { refused: 'private files', files: priv };
  const parent = git(repo, ['rev-parse', exists ? `refs/heads/${branch}` : `${from}^{commit}`]);
  return withTempIndex(repo, `save-${branch}`, env => {
    git(repo, ['read-tree', parent], { env });
    if (rel.length) git(repo, ['add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul'], { env, input: rel.join('\0') + '\0' });
    if (patch) git(repo, ['apply', '--cached', '--whitespace=nowarn', path.resolve(patch)], { env });
    const staged = git(repo, ['diff', '--cached', '--name-only', '--no-renames', parent], { env });
    if (!staged) return { nothing: true };
    const stagedPriv = lines(staged).filter(p => PRIVATE_FILE.test(p) && !ENV_EXAMPLE.test(p));
    if (stagedPriv.length) return { refused: 'private files', files: stagedPriv };
    const secrets = scanDiffForSecrets(git(repo, ['diff', '--cached', '--no-renames', '--no-ext-diff', parent], { env }));
    if (secrets.length) return { refused: 'possible secrets', secrets };
    const tree = git(repo, ['write-tree'], { env });
    const c = git(repo, ['commit-tree', tree, '-p', parent], { input: message.endsWith('\n') ? message : message + '\n' });
    git(repo, ['update-ref', '-m', `premerge save: ${message.split('\n')[0]}`, `refs/heads/${branch}`, c, exists ? parent : '']);
    return { commit: c, branch, parent, files: lines(staged), created: !exists };
  });
}

// ---------- the merging side ----------

/** Every unmerged local branch with its report (if any) and the files it shares with other branches. */
export function listBranches(repo, { base }) {
  const registry = registryFor(repo, registryDir(repo));
  const out = [];
  for (const b of lines(git(repo, ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads']))) {
    if (b === base || isAncestor(repo, b, base)) continue;
    const [behind, ahead] = git(repo, ['rev-list', '--left-right', '--count', `${base}...${b}`]).split(/\s+/).map(Number);
    const fromBranch = reportJson(git(repo, ['show', `refs/heads/${b}:${REPORT_DIR}/${slug(b)}.md`], { allowFail: true }));
    const report = fromBranch || registry.find(r => r.branch === b) || null;
    const files = lines(git(repo, ['diff', '--name-only', '--no-renames', `${base}...${b}`])).filter(f => !f.startsWith(`${REPORT_DIR}/`));
    out.push({ branch: b, ahead, behind, files, report: report ? { why: report.why, author: report.author, status: report.status, dependsOn: report.dependsOn || [], current: reportIsCurrent(repo, b, report.head), committed: !!fromBranch } : null });
  }
  for (const x of out) x.overlaps = out.filter(y => y !== x).map(y => ({ branch: y.branch, files: y.files.filter(f => x.files.includes(f)) })).filter(y => y.files.length);
  return out;
}

export function renderList(rows, { base }) {
  const s = [`# Branches waiting for ${code(base)}`, '', '| Branch | Ahead/behind | Report | Why | Shares files with |', '|---|---|---|---|---|'];
  for (const r of rows) {
    const rep = !r.report ? '**missing**' : `${r.report.status || '?'}${r.report.current ? '' : ' (stale)'}${r.report.committed ? '' : ' (registry only)'}`;
    s.push(`| ${code(r.branch)} | ${r.ahead}/${r.behind} | ${rep} | ${r.report?.why || ''} | ${r.overlaps.map(o => `${code(o.branch)} (${o.files.length})`).join(', ')} |`);
  }
  const missing = rows.filter(r => !r.report || !r.report.current);
  s.push('', missing.length ? `Ask for a fresh report before merging: ${missing.map(r => code(r.branch)).join(', ')}.` : 'Every branch has a current report.', '');
  return s.join('\n');
}

// ---------- CLI ----------

class UsageError extends Error {}
const usage = m => new UsageError(m);
const HELP = `premerge ${VERSION}: merge reports for branches written by many agents in one repository.

  premerge.mjs report --why "<why this change exists>" [--branch <b>] [--base <b>] [--notes notes.md]
                      [--author <name>] [--status ready|wip] [--depends-on a,b] [--commit] [--allow-empty]
                      [--repo <dir>] [--registry <dir>] [--no-registry] [--out <file>] [--json]
  premerge.mjs save   --branch <b> -m "<message>" [--from <ref>] [--patch <file.diff>] [--repo <dir>] -- <paths...>
  premerge.mjs list   [--base <b>] [--repo <dir>] [--json]

--why is mandatory: a merging agent must not merge a change whose purpose it does not understand.`;

export function main(argv = process.argv.slice(2)) {
  const o = parseArgs(argv);
  if (o.version) { console.log(VERSION); return 0; }
  if (o.help) { console.log(HELP); return 0; }
  const cmd = ['report', 'save', 'list'].includes(o._[0]) ? o._.shift() : 'report';
  const repo = toplevel(path.resolve(o.repo || process.cwd()));

  if (cmd === 'save') {
    const r = saveWork(repo, { branch: o.branch, message: o.message, paths: o._, from: o.from || 'HEAD', patch: o.patch || null });
    if (r.refused) {
      console.error(`Refused (${r.refused}): ${(r.files || r.secrets.map(x => `${x.file} [${x.kind}]`)).join(', ')}. Nothing was written.`);
      return 5;
    }
    if (r.nothing) { console.error('Nothing to save: the chosen paths do not differ from the branch.'); return 4; }
    console.log(o.json ? JSON.stringify(r) : `${r.created ? 'Created' : 'Updated'} ${r.branch} at ${r.commit.slice(0, 10)} with ${r.files.length} file(s). Working tree and index untouched.`);
    return 0;
  }

  if (cmd === 'list') {
    const base = o.base || defaultBase(repo, loadConfig(repo));
    const rows = listBranches(repo, { base });
    console.log(o.json ? JSON.stringify({ base, branches: rows }, null, 1) : renderList(rows, { base }));
    return 0;
  }

  const why = String(o.why || '').trim();
  if (!why) {
    console.error('Missing --why "<why this change exists, one sentence>". The merging agent will not merge a change whose purpose it does not understand.');
    return 3;
  }
  const branch = o.branch || git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch === 'HEAD') throw usage('detached HEAD: pass --branch <name>');
  if (!refExists(repo, `refs/heads/${branch}`)) throw usage(`no local branch named ${branch}`);
  const config = loadConfig(repo, branch);
  const base = o.base || defaultBase(repo, config);
  if (base === branch) throw usage(`the branch is its own base (${base}); pass --base <target branch>`);
  const facts = collect(repo, { branch, base, config });
  if (o.commit && !o['allow-empty'] && !facts.files.some(p => !p.file.startsWith(`${REPORT_DIR}/`))) {
    console.error(`Branch ${branch} changes nothing against ${base} apart from premerge reports. Check that the work itself was committed; pass --allow-empty to write the report anyway.`);
    return 4;
  }
  const regDir = o['no-registry'] ? null : registryDir(repo, o.registry);
  const others = new Map();
  for (const r of [...reportsInDir(path.join(repo, REPORT_DIR), branch), ...reportsOnBranches(repo, { base, exclude: branch }), ...(regDir ? registryFor(repo, regDir) : [])]) {
    // only branches that still wait for a merge: a report of a merged branch is history, not a risk
    if (!r.branch || r.branch === branch || !refExists(repo, `refs/heads/${r.branch}`) || isAncestor(repo, r.branch, base)) continue;
    const prev = others.get(r.branch);
    if (!prev || String(r.at) > String(prev.at)) others.set(r.branch, r);
  }
  const md = renderReport(facts, {
    notes: o.notes ? readFileSync(o.notes, 'utf8') : '', author: o.author || git(repo, ['config', 'user.name'], { allowFail: true }) || '', why,
    status: o.status || 'ready', dependsOn: String(o['depends-on'] || '').split(',').map(x => x.trim()).filter(Boolean),
    production: againstProduction(repo, branch, { base, pattern: config.productionBranches }), others: [...others.values()], overlaps: overlappingBranches(repo, { ...facts, days: Number(config.overlapDays) || 7 }),
  });
  const rel = `${REPORT_DIR}/${slug(branch)}.md`, result = { branch, base, files: facts.files.length, partial: facts.partial.length };
  if (o.out) { writeFileSync(path.resolve(o.out), md); result.file = path.resolve(o.out).replace(/\\/g, '/'); }
  if (o.commit) {
    result.commit = commitFileToBranch(repo, branch, rel, md, `docs(premerge): report for ${branch}\n\n${why}\n`).slice(0, 10);
    result.show = `git show ${branch}:${rel}`;
  } else if (!o.out) {
    mkdirSync(path.join(repo, REPORT_DIR), { recursive: true });
    writeFileSync(path.join(repo, rel), md);
    result.file = path.join(repo, rel).replace(/\\/g, '/');
  }
  if (regDir) result.registry = appendRegistry(md, regDir, { repoPath: commonDir(repo) });
  if (o.json) console.log(JSON.stringify(result));
  else console.log([`Report for ${branch} -> ${base}: ${result.files} file(s), ${result.partial} partial.`,
    result.commit ? `Committed on ${branch} as ${result.commit} (no checkout). Read it with: ${result.show}` : `Written to ${result.file}`,
    result.registry ? `Registry copy: ${result.registry}` : null, `Merge with: git merge --no-ff ${branch}`].filter(Boolean).join('\n'));
  return 0;
}

const isMain = process.argv[1] && samePath(process.argv[1], fileURLToPath(import.meta.url));
if (isMain) {
  try { process.exitCode = main(); } catch (e) {
    console.error(e instanceof UsageError ? `premerge: ${e.message}\n\n${HELP}` : `premerge: ${e.message}`);
    process.exitCode = e instanceof UsageError ? 2 : 1;
  }
}
