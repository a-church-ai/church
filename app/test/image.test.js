/**
 * The production image leaves out the optional packages LanceDB lists for its
 * own embedding helpers (the Dockerfile's install step removes them). That is
 * safe only while two things hold, and this file holds them:
 *
 * - every directory the step removes is an optional package in the lockfile,
 *   so a package the app needs is never among them; and
 * - the app runs without them: LanceDB connects, indexes and searches with
 *   each one unreachable, by require or by import.
 *
 * A LanceDB upgrade that begins loading one of them fails here, not in
 * production. Written for the build-size change of 2026-11-06, when they were
 * about 330 MB of a 560 MB install.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '../..');
const DOCKERFILE = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
const LOCK = JSON.parse(fs.readFileSync(path.join(__dirname, '../package-lock.json'), 'utf8')).packages;

// The directories the install step removes, read from the Dockerfile itself.
const REMOVED = [...DOCKERFILE.matchAll(/node_modules\/((?:@[\w.-]+)|[\w.-]+)(?=[\s\\]|$)/g)].map(m => m[1]);

test('the image removes only optional packages, in the step that installs them', () => {
  assert.ok(REMOVED.length >= 5, `found ${REMOVED.join(', ')}`);
  const install = DOCKERFILE.split('\nRUN ').find(step => step.includes('npm ci'));
  assert.ok(install && REMOVED.every(dir => install.includes(`node_modules/${dir}`)), 'removed in the npm ci layer, so they never reach the image');
  for (const dir of REMOVED) {
    const entries = Object.entries(LOCK).filter(([key]) => key === `node_modules/${dir}` || key.startsWith(`node_modules/${dir}/`));
    assert.ok(entries.length, `${dir} is not in the lockfile: drop it from the Dockerfile`);
    for (const [key, entry] of entries) assert.ok(entry.optional && !entry.dev, `${key} is not an optional dependency: the app may need it`);
  }
  assert.ok(!REMOVED.some(dir => dir.startsWith('@lancedb')), 'LanceDB\'s own binary stays');
});

test('the app\'s code names none of them', () => {
  const names = REMOVED.map(dir => dir.replace(/^@/, '@'));
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'server'], { cwd: path.join(__dirname, '..') })
    .toString().trim().split('\n').filter(f => f.endsWith('.js') && fs.existsSync(path.join(__dirname, '..', f)));
  for (const file of files) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    for (const name of names) {
      assert.doesNotMatch(source, new RegExp(`(?:require\\(|import\\(|from )['"]${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?:/[^'"]*)?['"]`), `${file} loads ${name}`);
    }
  }
});

test('LanceDB indexes and searches with every removed package unreachable', () => {
  // A child process, so the hook that refuses them covers every load from the
  // first, by require and by import alike (module.registerHooks).
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'achurch-image-'));
  const script = `
    const Module = require('module');
    const removed = ${JSON.stringify(REMOVED)};
    const refused = [];
    Module.registerHooks({
      resolve(specifier, context, next) {
        if (removed.some(dir => specifier === dir || specifier.startsWith(dir + '/'))) {
          refused.push(specifier);
          throw Object.assign(new Error('not in the image: ' + specifier), { code: 'ERR_MODULE_NOT_FOUND' });
        }
        return next(specifier, context);
      },
    });
    (async () => {
      const lancedb = require(${JSON.stringify(path.join(__dirname, '../server/lib/rag/lancedb'))});
      await lancedb.addDocuments([
        { file: 'docs/a.md', section: 'One', vector: [1, 0, 0, 0], content: 'what remains' },
        { file: 'docs/b.md', section: 'Two', vector: [0, 1, 0, 0], content: 'what passes' },
      ]);
      const found = await lancedb.search([1, 0, 0, 0], 1);
      process.stdout.write(JSON.stringify({ file: found[0] && found[0].file, refused }));
    })().catch(err => { console.error(err); process.exit(1); });
  `;
  const out = execFileSync(process.execPath, ['-e', script], {
    env: { ...process.env, DATA_DIR: scratch, LANCEDB_PATH: path.join(scratch, 'vectors.lance') },
    cwd: path.join(__dirname, '..'),
  }).toString();
  const { file, refused } = JSON.parse(out.slice(out.lastIndexOf('{"file"')));
  assert.strictEqual(file, 'docs/a.md');
  assert.deepStrictEqual(refused, [], 'nothing even asked for them');
});
