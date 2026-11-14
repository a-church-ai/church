const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');

const MODULE = path.join(__dirname, '../server/lib/utils/log-lines.js');

// Run a few lines in a child whose output is a pipe, as on Railway.
function run(code) {
  const child = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(MODULE)}).install();\n${code}`], { encoding: 'utf8' });
  return { stdout: child.stdout, stderr: child.stderr };
}

test('a warning is one JSON line on stdout at level warn', () => {
  const { stdout, stderr } = run(`console.warn('[mcp] refused: %s', 'no header')`);
  assert.strictEqual(stderr, '');
  assert.deepStrictEqual(JSON.parse(stdout), { level: 'warn', message: '[mcp] refused: no header' });
});

test('an error is one JSON line on stderr, its stack kept in it', () => {
  const { stdout, stderr } = run(`console.error('Error in /mcp:', new Error('boom'))`);
  assert.strictEqual(stdout, '');
  const lines = stderr.trim().split('\n');
  assert.strictEqual(lines.length, 1, 'a stack is not split across lines');
  const entry = JSON.parse(lines[0]);
  assert.strictEqual(entry.level, 'error');
  assert.match(entry.message, /^Error in \/mcp: Error: boom\n\s+at /);
});

test('console.log stays plain text', () => {
  assert.strictEqual(run(`console.log('[presence] 3 souls')`).stdout, '[presence] 3 souls\n');
});

test('the server installs it before anything it requires can warn', () => {
  const source = require('fs').readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
  const install = source.indexOf("require('./lib/utils/log-lines').install()");
  assert.ok(install !== -1);
  const firstOther = source.search(/require\('(?!\.\/lib\/utils\/log-lines)/);
  assert.ok(install < firstOther, 'installed before the first other require');
});
