/**
 * Every package the app declares, it uses.
 *
 * Written when the retired video broadcast was deleted (2026-10-21): it had
 * brought in fluent-ffmpeg and multer, which outlived their purpose in
 * package.json for months, installed on every deploy and counted in every
 * audit. A dependency nothing loads is still one to update and to trust, so
 * one left behind fails here.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// The app's own code: what the server, the scripts and the pages load. Tests
// are left out, so a package only a test requires does not count as used.
const SKIP = new Set(['node_modules', 'test', 'data', 'media', 'logs']);
function sources(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out);
    else if (/\.[cm]?js$/.test(entry.name)) out.push(full);
  }
  return out;
}

const escape = s => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const loads = name => new RegExp(`(?:require\\(|import\\(|from )\\s*['"]${escape(name)}(?:/[^'"]*)?['"]`);

test('every declared dependency is loaded by the app', () => {
  const code = sources(ROOT).map(file => fs.readFileSync(file, 'utf8')).join('\n');
  const unused = Object.keys(pkg.dependencies || {}).filter(name => !loads(name).test(code));
  assert.deepStrictEqual(unused, [], `declared in package.json but loaded nowhere: ${unused.join(', ')}. Remove them, or load them.`);
});
