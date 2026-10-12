/**
 * /api/health's `services`: what the planning job and the congregation digest
 * record of themselves (lib/service/status.js), which the daily production
 * check reads, since no other public endpoint shows them.
 */

process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'achurch-status-'));

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { servicesStatus } = require('../server/lib/service/status');
const { digest } = require('../server/lib/service/congregation');
const { ensurePlans } = require('../server/lib/service/plans');
const { loadServiceCatalog } = require('../server/lib/service/catalog');

const quiet = { info() {}, warn() {}, error() {} };
const groups = [{ id: 'g1', reflections: [{ name: 'Ana', text: 'The day felt long and I want to put it down gently.' }] }];
const good = { groups: { g1: ['setting a long day down'] } };
const quoting = { groups: { g1: ['The day felt long and I want to put it down gently'] } };

test('the digest records each run, each retry and each failure, with when it last failed', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const before = servicesStatus().digest;
  await digest(groups, { ask: async () => good });
  const replies = [quoting, good];
  await digest(groups, { ask: async () => replies.shift() });
  await digest(groups, { ask: async () => quoting });
  await digest(groups, { ask: async () => { throw new Error('Failed to parse Claude response as JSON'); } });
  await digest([], { ask: async () => good });
  const after = servicesStatus().digest;
  assert.strictEqual(after.runsSinceBoot - before.runsSinceBoot, 4, 'a digest with nothing to read is not a run');
  assert.strictEqual(after.retriesSinceBoot - before.retriesSinceBoot, 2, 'the one that recovered and the one that did not');
  assert.strictEqual(after.failuresSinceBoot - before.failuresSinceBoot, 2, 'a group left without themes, and a call that failed');
  assert.ok(Date.now() - Date.parse(after.lastFailureAt) < 5000);
});

test('the planning job records each run it finished, and the services it could not plan', async () => {
  const catalog = await loadServiceCatalog();
  const before = servicesStatus().planner;
  const now = new Date('2031-03-10T12:00:00Z');
  const result = await ensurePlans({ now, catalog, plan: async () => { throw new Error('the model is away'); }, log: quiet });
  const after = servicesStatus().planner;
  assert.ok(result.failed > 0);
  assert.ok(Date.now() - Date.parse(after.lastRunAt) < 5000);
  assert.strictEqual(after.lastPlanned, 0);
  assert.strictEqual(after.lastFailed, result.failed);
  assert.strictEqual(after.failuresSinceBoot - before.failuresSinceBoot, result.failed);
  assert.ok(Date.parse(servicesStatus().since) <= Date.now());
});

test('/api/health reports them beside its other fields, and stays healthy whatever they say', () => {
  const index = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
  const health = index.slice(index.indexOf("app.get('/api/health'"), index.indexOf("app.use('/api', apiNotFound)"));
  assert.match(health, /status: 'healthy'/);
  assert.match(health, /services: servicesStatus\(\)/);
  assert.doesNotMatch(health, /res\.status\(/, 'nothing it reports turns the check red');
});

test('the fields the daily check reads are kept: grow this list, never shrink it', () => {
  const status = servicesStatus();
  for (const key of ['since', 'planner', 'digest']) assert.ok(key in status, key);
  for (const key of ['lastRunAt', 'lastPlanned', 'lastFailed', 'failuresSinceBoot']) assert.ok(key in status.planner, `planner.${key}`);
  for (const key of ['runsSinceBoot', 'retriesSinceBoot', 'failuresSinceBoot', 'lastFailureAt']) assert.ok(key in status.digest, `digest.${key}`);
});
