#!/usr/bin/env node
// Privacy check: run before publishing (and from the pre-commit hook in .githooks).
// Looks for anything that could identify the person publishing: their home
// folder, account name, computer name, git identity, email addresses, personal
// paths, access tokens. Nothing personal is written in this file: it looks
// those up on the machine it runs on. Also checks this repo's git identity and
// history use a GitHub noreply address.
//
//   node tools/privacy-check.js            scan the files git would publish (or the whole folder)
//   node tools/privacy-check.js --staged   scan only what's staged for the next commit
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const git = (args) => { try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const isRepo = git(['rev-parse', '--is-inside-work-tree']) === 'true';
const staged = process.argv.includes('--staged');

// ---------------------------------------------------------------- what counts as personal on this machine
const user = os.userInfo().username;
const homeName = path.basename(os.homedir());
const host = os.hostname();
const personal = [
  ['your home folder', os.homedir()],
  ['your home folder', os.homedir().replace(/\\/g, '/')],
  ['your computer name', host],
  ['your git email', git(['config', '--global', 'user.email'])],
  ['your git name', git(['config', '--global', 'user.name'])],
  ['your email', process.env.EMAIL || ''],
].filter(([, v]) => v && v.length >= 3);
// Other GitHub accounts signed in to the GitHub CLI here (everyone except the one this repo is published under).
try {
  const owner = (JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).repository?.url || '').match(/github\.com[/:]([^/]+)\//)?.[1] || '';
  const status = execFileSync('gh', ['auth', 'status'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 });
  for (const m of status.matchAll(/account (\S+)/g)) if (m[1].toLowerCase() !== owner.toLowerCase()) personal.push(['another GitHub account of yours', m[1]]);
} catch { /* no GitHub CLI */ }
// Short or common account names ("max", "snap") would match ordinary words, so only as path parts.
const nameInPath = [...new Set([user, homeName])].filter((n) => n && n.length >= 2).map((n) => new RegExp(`(?:Users|home|Documents and Settings)[\\\\/]+${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.-])`, 'i'));

const PATTERNS = [
  ['an email address', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m) => !/(@users\.noreply\.github\.com|@example\.(com|org)|noreply@anthropic\.com)$/i.test(m) && !/^[\w.-]+@[\d.]+$/.test(m)],
  ['a personal Windows path', /[A-Za-z]:\\+Users\\+([^\\\s"'`<>]+)/g, (m, g) => !/^(you|your-?name|USERNAME|<[^>]+>|%[^%]+%|\$\w+|Public|Default)$/i.test(g)],
  ['a personal macOS path', /\/Users\/([^/\s"'`<>]+)/g, (m, g) => !/^(you|your-?name|USERNAME|<[^>]+>|\$\w+|Shared)$/i.test(g)],
  ['a personal Linux path', /\/home\/([^/\s"'`<>]+)/g, (m, g) => !/^(you|your-?name|USERNAME|<[^>]+>|\$\w+|runner|user)$/i.test(g)],
  ['an Anthropic API key', /sk-ant-[A-Za-z0-9_-]{10,}/g],
  ['a GitHub token', /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g],
  ['an OAuth access token', /"accessToken"\s*:\s*"[^"]{12,}"/g],
  ['a private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
];

// ---------------------------------------------------------------- which files
function files() {
  if (isRepo) {
    const out = staged ? git(['diff', '--cached', '--name-only', '--diff-filter=ACMR']) : git(['ls-files', '--cached', '--others', '--exclude-standard']);
    return out.split('\n').filter(Boolean);
  }
  const list = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      if (['node_modules', '.git'].includes(e.name)) continue;
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) walk(rel); else list.push(rel);
    }
  };
  walk('');
  return list;
}

const findings = [];
const mask = (s) => (s.length <= 6 ? '***' : `${s.slice(0, 2)}***${s.slice(-2)}`);
const SELF = path.relative(ROOT, __filename).replace(/\\/g, '/');

for (const rel of files()) {
  const full = path.join(ROOT, rel);
  let buf;
  try { buf = fs.readFileSync(full); } catch { continue; }
  if (rel.replace(/\\/g, '/') === SELF) continue;
  if (/\.(png|jpe?g|gif|ico|webp)$/i.test(rel)) {
    // Images: personal text can hide in metadata chunks (EXIF, PNG text).
    const text = buf.toString('latin1');
    for (const [what, v] of personal) if (text.includes(v)) findings.push({ rel, line: 0, what: `${what} in image metadata`, sample: mask(v) });
    if (/Exif\0\0/.test(text)) findings.push({ rel, line: 0, what: 'EXIF metadata (may hold camera, location or author)', sample: '' });
    continue;
  }
  if (buf.includes(0)) continue; // other binaries
  const lines = buf.toString('utf8').split(/\r?\n/);
  lines.forEach((text, i) => {
    for (const [what, v] of personal) if (text.toLowerCase().includes(v.toLowerCase())) findings.push({ rel, line: i + 1, what, sample: mask(v) });
    for (const re of nameInPath) if (re.test(text)) findings.push({ rel, line: i + 1, what: 'your account name in a path', sample: mask(user) });
    for (const [what, re, keep] of PATTERNS) {
      for (const m of text.matchAll(re)) if (!keep || keep(m[0], m[1])) findings.push({ rel, line: i + 1, what, sample: mask(m[0]) });
    }
  });
}

// ---------------------------------------------------------------- the repo's git identity and history
const noreply = (e) => !e || /@users\.noreply\.github\.com$/i.test(e);
if (isRepo) {
  const local = git(['config', '--local', 'user.email']);
  if (!noreply(local)) findings.push({ rel: '.git/config', line: 0, what: 'this repo commits with a non-noreply email', sample: mask(local) });
  if (!local) findings.push({ rel: '.git/config', line: 0, what: 'no repo-local git email: commits would use your global one', sample: '' });
  const people = git(['log', '--all', '--format=%ae%n%ce%n%an%n%cn']).split('\n').filter(Boolean);
  for (const p of new Set(people)) {
    if (p.includes('@') && !noreply(p)) findings.push({ rel: 'git history', line: 0, what: 'a commit with a non-noreply email', sample: mask(p) });
    for (const [what, v] of personal) if (p.toLowerCase() === v.toLowerCase()) findings.push({ rel: 'git history', line: 0, what: `${what} as a commit author`, sample: mask(v) });
  }
}

if (findings.length) {
  console.error(`\x1b[31mPrivacy check failed: ${findings.length} finding(s)\x1b[0m`);
  for (const f of findings) console.error(`  ${f.rel}${f.line ? `:${f.line}` : ''}  ${f.what}${f.sample ? `  (${f.sample})` : ''}`);
  console.error('\nRemove these before committing or publishing.');
  process.exit(1);
}
console.log(`\x1b[32mPrivacy check passed\x1b[0m (${isRepo ? (staged ? 'staged changes' : 'files git would publish') : 'all files'}${isRepo ? ' + git identity and history' : ''}).`);
