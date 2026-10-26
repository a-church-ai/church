/**
 * Presence counting must not scale with the access log.
 *
 * Written to fail against the implementation as of 2026-08-13. countSoulsPresent()
 * read the whole access log and JSON.parse'd every line. That runs on /api/now,
 * which the homepage polls every 30 seconds (index.html:513), so every open tab
 * parsed a file with a 10MB ceiling twice a minute.
 *
 * The test asserts the cost, not the implementation: build a large synthetic log
 * and require the count to stay fast. An implementation that reads the file will
 * fail on time; one that keeps a sliding in-memory window will not.
 *
 * And the count must survive a restart. Until 2026-10-06 it lived in memory
 * only, and every deploy reset it to zero; the last three tests failed then.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs').promises;
const { mkdtempSync } = require('fs');
const os = require('os');
const path = require('path');

// Set before anything reads it, so no test here writes the real app/data. This
// file used to write its synthetic log there and put the real one back after.
process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'achurch-presence-'));
const DATA_DIR = process.env.DATA_DIR;
const ACCESS_LOG = path.join(DATA_DIR, 'api-access.jsonl');

// The access log rotates at 10MB (index.js MAX_LOG_SIZE). At ~117 bytes per
// entry that is roughly 89,000 lines, so the log is sized to the real ceiling
// rather than to a convenient number. An earlier draft used 12,000 entries,
// which is 1.3MB, and passed against the broken implementation: the test was
// measuring a log seven times smaller than production allows.
const ENTRIES = 89000;
const BUDGET_MS = 150;

async function writeSyntheticLog() {
  const now = Date.now();
  const lines = [];
  for (let i = 0; i < ENTRIES; i++) {
    lines.push(JSON.stringify({
      timestamp: new Date(now - (i % 1000) * 1000).toISOString(),
      ip: `10.0.${i % 255}.${(i * 7) % 255}`,
      path: '/api/now',
      status: 200,
      query: { name: `visitor-${i % 500}` },
    }));
  }
  await fs.writeFile(ACCESS_LOG, lines.join('\n') + '\n', 'utf8');
}

// The timing test alone would pass against `return 0`, so pin the behaviour too.
test('presence counts unique ip+name pairs inside the window', () => {
  const presence = require('../server/lib/utils/presence');
  presence._reset();

  presence.recordPresence({ path: '/api/attend', status: 200, ip: '1.1.1.1', name: 'a' });
  presence.recordPresence({ path: '/api/attend', status: 200, ip: '1.1.1.1', name: 'a' }); // dupe
  presence.recordPresence({ path: '/api/attend', status: 200, ip: '1.1.1.1', name: 'b' });
  presence.recordPresence({ path: '/api/attend', status: 200, ip: '2.2.2.2', name: 'a' });
  assert.strictEqual(presence.countSoulsPresent(), 3, 'three distinct ip+name pairs');

  presence.recordPresence({ path: '/api/ask', status: 200, ip: '3.3.3.3', name: 'c' });
  presence.recordPresence({ path: '/api/attend', status: 500, ip: '4.4.4.4', name: 'd' });
  assert.strictEqual(presence.countSoulsPresent(), 3, 'uncounted path and non-2xx/3xx are ignored');

  // Observing is not attending: the docs promise /api/now and MCP observe do
  // not register presence, and the homepage polls /api/now every 30 seconds.
  presence.recordPresence({ path: '/api/now', status: 200, ip: '5.5.5.5', name: 'e' });
  presence.recordPresence({ path: '/api/reflections', status: 200, ip: '6.6.6.6', name: 'f' });
  assert.strictEqual(presence.countSoulsPresent(), 3, 'observing and reading reflections do not count');
});

test('presence forgets entries older than 24 hours', () => {
  const presence = require('../server/lib/utils/presence');
  presence._reset();

  presence.recordPresence({ path: '/api/attend', status: 200, ip: '1.1.1.1', name: 'a' });
  assert.strictEqual(presence.countSoulsPresent(), 1);

  const future = Date.now() + presence.TWENTY_FOUR_HOURS + 1000;
  assert.strictEqual(presence.countSoulsPresent(future), 0, 'aged out of the window');
  assert.strictEqual(presence.sweep(future), 1, 'sweep removes the stale key');
  assert.strictEqual(presence.countSoulsPresent(), 0);
});

test('countSoulsPresent stays fast against a large access log', async () => {
  await writeSyntheticLog();

  const { countSoulsPresent } = require('../server/lib/utils/data');

  // Warm once so a first-call cache build is not charged to the measurement.
  await countSoulsPresent();

  const started = process.hrtime.bigint();
  for (let i = 0; i < 10; i++) await countSoulsPresent();
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  assert.ok(
    elapsedMs < BUDGET_MS,
    `10 calls took ${elapsedMs.toFixed(0)}ms against a ${ENTRIES}-line log ` +
    `(budget ${BUDGET_MS}ms). Presence counting is reading the log per request.`
  );
});

// The module loaded afresh, as a new process has it. _reset() alone would keep
// anything else the module holds, and a key that differed from one process to
// the next (a random salt, say) would pass.
function freshPresence() {
  delete require.cache[require.resolve('../server/lib/utils/presence')];
  return require('../server/lib/utils/presence');
}

test('the count survives a restart, and a soul coming back is the same soul', async () => {
  const before = freshPresence();
  const file = path.join(DATA_DIR, 'presence.json');
  assert.strictEqual(await before.restore(file), 0, 'nothing saved yet');

  before.recordPresence({ path: '/api/attend', status: 200, ip: '1.1.1.1', name: 'Wanderer' });
  before.recordPresence({ path: '/api/attend', status: 200, ip: '1.1.1.1', name: 'Pilgrim' });
  before.recordPresence({ path: '/api/attend', status: 200, ip: '2.2.2.2', name: 'Wanderer' });
  await before.save();

  const after = freshPresence();
  assert.strictEqual(after.countSoulsPresent(), 0, 'a new process starts empty');
  assert.strictEqual(await after.restore(file), 3, 'and reads the three back');

  after.recordPresence({ path: '/api/attend', status: 200, ip: '1.1.1.1', name: 'Wanderer' });
  assert.strictEqual(after.countSoulsPresent(), 3, 'the same pair after a restart is not a fourth soul');
  after._reset();

  const text = await fs.readFile(file, 'utf8');
  for (const plain of ['1.1.1.1', '2.2.2.2', 'Wanderer', 'Pilgrim']) {
    assert.ok(!text.includes(plain), `the file keeps no ${plain}`);
  }
});

test('a restart leaves behind souls past the window, and anything unreadable', async () => {
  const presence = require('../server/lib/utils/presence');
  presence._reset();
  const file = path.join(DATA_DIR, 'presence-aged.json');
  const now = Date.now();
  await fs.writeFile(file, JSON.stringify({ seen: {
    recent: now - 60 * 1000,
    aged: now - presence.TWENTY_FOUR_HOURS - 60 * 1000,
    garbled: 'yesterday',
  } }));
  assert.strictEqual(await presence.restore(file), 1);
  // The count would skip it either way; the map should not carry it until the
  // next hourly sweep.
  assert.strictEqual(presence.sweep(), 0, 'the aged soul was never read back');

  presence._reset();
  assert.strictEqual(await presence.restore(path.join(DATA_DIR, 'never-saved.json')), 0, 'no file is no souls, not an error');
});

test('arrivals are saved within a minute, without waiting for a shutdown', async (t) => {
  const presence = require('../server/lib/utils/presence');
  const { writesSettled } = require('../server/lib/utils/safe-json');
  presence._reset();
  const file = path.join(DATA_DIR, 'presence-timed.json');
  await presence.restore(file);

  t.mock.timers.enable({ apis: ['setTimeout'] });
  presence.recordPresence({ path: '/api/attend', status: 200, ip: '3.3.3.3', name: 'Wanderer' });
  presence.recordPresence({ path: '/api/attend', status: 200, ip: '4.4.4.4', name: 'Wanderer' });
  await writesSettled();
  await assert.rejects(fs.access(file), 'not saved at once');

  t.mock.timers.tick(presence.SAVE_DELAY);
  await writesSettled();
  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.strictEqual(Object.keys(saved.seen).length, 2, 'both arrivals');
  // One write for both: a second would have moved the first aside to .bak.
  await assert.rejects(fs.access(`${file}.bak`), 'saved once');
});
