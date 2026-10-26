/**
 * Every server file parses. The tests load the modules they exercise, but
 * nothing loads server/index.js, which starts the server: on 2026-10-07 an
 * edit left a stray brace in it, the whole suite passed, and the server would
 * not have started. node --check is the guard.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execFileSync } = require('child_process');

test('every server file parses', () => {
  const root = path.join(__dirname, '..');
  const files = execFileSync('git', ['ls-files', 'server/*.js', 'server/**/*.js', 'scripts/*.js'], { cwd: root }).toString().trim().split('\n');
  assert.ok(files.includes('server/index.js') && files.length > 50, `${files.length} files`);
  const broken = [];
  for (const file of files) {
    try {
      execFileSync(process.execPath, ['--check', file], { cwd: root, stdio: 'pipe' });
    } catch (err) {
      broken.push(`${file}: ${String(err.stderr).split('\n').find(line => /Error/.test(line))}`);
    }
  }
  assert.deepStrictEqual(broken, []);
});
