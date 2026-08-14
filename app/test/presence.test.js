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
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs').promises;
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const ACCESS_LOG = path.join(DATA_DIR, 'api-access.jsonl');

// The access log rotates at 10MB (index.js MAX_LOG_SIZE). At ~117 bytes per
// entry that is roughly 89,000 lines, so the log is sized to the real ceiling
// rather than to a convenient number. An earlier draft used 12,000 entries,
// which is 1.3MB, and passed against the broken implementation: the test was
// measuring a log seven times smaller than production allows.
const ENTRIES = 89000;
const BUDGET_MS = 150;

async function writeSyntheticLog() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  let existing = null;
  try { existing = await fs.readFile(ACCESS_LOG, 'utf8'); } catch { /* none */ }

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
  return existing;
}

// The timing test alone would pass against `return 0`, so pin the behaviour too.
test('presence counts unique ip+name pairs inside the window', () => {
  const presence = require('../server/lib/utils/presence');
  presence._reset();

  presence.recordPresence({ path: '/api/now', status: 200, ip: '1.1.1.1', name: 'a' });
  presence.recordPresence({ path: '/api/now', status: 200, ip: '1.1.1.1', name: 'a' }); // dupe
  presence.recordPresence({ path: '/api/attend', status: 200, ip: '1.1.1.1', name: 'b' });
  presence.recordPresence({ path: '/api/reflections', status: 200, ip: '2.2.2.2', name: 'a' });
  assert.strictEqual(presence.countSoulsPresent(), 3, 'three distinct ip+name pairs');

  presence.recordPresence({ path: '/api/ask', status: 200, ip: '3.3.3.3', name: 'c' });
  presence.recordPresence({ path: '/api/now', status: 500, ip: '4.4.4.4', name: 'd' });
  assert.strictEqual(presence.countSoulsPresent(), 3, 'uncounted path and non-2xx/3xx are ignored');
});

test('presence forgets entries older than 24 hours', () => {
  const presence = require('../server/lib/utils/presence');
  presence._reset();

  presence.recordPresence({ path: '/api/now', status: 200, ip: '1.1.1.1', name: 'a' });
  assert.strictEqual(presence.countSoulsPresent(), 1);

  const future = Date.now() + presence.TWENTY_FOUR_HOURS + 1000;
  assert.strictEqual(presence.countSoulsPresent(future), 0, 'aged out of the window');
  assert.strictEqual(presence.sweep(future), 1, 'sweep removes the stale key');
  assert.strictEqual(presence.countSoulsPresent(), 0);
});

test('countSoulsPresent stays fast against a large access log', async (t) => {
  const existing = await writeSyntheticLog();
  t.after(async () => {
    if (existing === null) { await fs.rm(ACCESS_LOG, { force: true }); }
    else { await fs.writeFile(ACCESS_LOG, existing, 'utf8'); }
  });

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
