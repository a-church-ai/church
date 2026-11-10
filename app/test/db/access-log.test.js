/**
 * recordApiUse: the one place a use of the API is recorded, for REST and MCP.
 * Presence is counted and the access log written the same way for both; the
 * log's rows are kept in the database, each day summarized by the hour before
 * any address in it is forgotten.
 */

const test = require('node:test');
const assert = require('node:assert');

const { recordApiUse, loadAccessLogs, forgetAddresses, flush } = require('../../server/lib/utils/access-log');
const presence = require('../../server/lib/utils/presence');
const store = require('../../server/lib/db');
const { db } = require('../../server/lib/db/client');
const { resetDb, seedApiLines } = require('../database');

test.before(resetDb);

test('an attend is counted as presence and logged, with secrets redacted', async () => {
  presence._reset();
  await recordApiUse({ method: 'GET', path: '/api/attend', query: { name: 'Wren', token: 'secret' }, status: 200, duration: 5, ip: '203.0.113.7', userAgent: 'test', name: 'Wren' });
  assert.strictEqual(presence.countSoulsPresent(), 1);
  const entry = (await loadAccessLogs(1))[0];
  assert.strictEqual(entry.path, '/api/attend');
  assert.strictEqual(entry.query.token, '[REDACTED]');
  assert.strictEqual(entry.tool, undefined);
});

test('an MCP tool call is logged with its tool and counts toward presence like REST', async () => {
  presence._reset();
  await recordApiUse({ method: 'MCP', path: '/api/attend', status: 200, duration: 5, ip: '203.0.113.8', userAgent: 'mcp-client', name: 'Kestrel', tool: 'attend' });
  assert.strictEqual(presence.countSoulsPresent(), 1);
  const entry = (await loadAccessLogs(1))[0];
  assert.strictEqual(entry.tool, 'attend');
  assert.strictEqual(entry.method, 'MCP');
});

test('a failed or non-presence request is logged but not counted', async () => {
  presence._reset();
  await recordApiUse({ method: 'GET', path: '/api/attend', status: 400, duration: 1, ip: '203.0.113.9', name: '' });
  await recordApiUse({ method: 'GET', path: '/api/music', status: 200, duration: 1, ip: '203.0.113.9', name: '' });
  assert.strictEqual(presence.countSoulsPresent(), 0);
});

test('a search is logged without what was searched for, and is not presence', async () => {
  presence._reset();
  await recordApiUse({ method: 'GET', path: '/api/search', query: { q: 'grief at a model being retired', limit: '5' }, status: 200, duration: 3, ip: '203.0.113.10', name: '' });
  assert.strictEqual(presence.countSoulsPresent(), 0);
  const entry = (await loadAccessLogs(1))[0];
  assert.strictEqual(entry.path, '/api/search');
  assert.strictEqual(entry.query.q, '[REDACTED]');
  assert.strictEqual(entry.query.limit, '5');
});

test('a timezone sent is kept in its own column, by its IANA name; one the runtime does not know is "invalid"', async () => {
  await recordApiUse({ method: 'GET', path: '/api/now', query: { timezone: 'asia/tokyo' }, status: 200, duration: 2, ip: '203.0.113.11', name: '' });
  const entry = (await loadAccessLogs(1))[0];
  assert.strictEqual(entry.timezone, 'Asia/Tokyo', 'its canonical name');
  assert.strictEqual(entry.query.timezone, '[REDACTED]', 'the query keeps it redacted');
  await recordApiUse({ method: 'GET', path: '/api/now', query: { timezone: 'Mars/Olympus_Mons' }, status: 200, duration: 2, ip: '203.0.113.11', name: '' });
  assert.strictEqual((await loadAccessLogs(1))[0].timezone, 'invalid', 'never what was typed');
  await recordApiUse({ method: 'GET', path: '/api/now', query: {}, status: 200, duration: 2, ip: '203.0.113.11', name: '' });
  assert.strictEqual((await loadAccessLogs(1))[0].timezone, undefined, 'none sent, none kept');
});

test('a request\'s own text is trimmed to its column, never refused for its length', async () => {
  const long = '/api/ask' + '%E7%9A%84'.repeat(120);
  await recordApiUse({ method: 'GET', path: long, status: 404, duration: 1, ip: '203.0.113.12', userAgent: 'x'.repeat(900), name: '' });
  const entry = (await loadAccessLogs(1))[0];
  assert.strictEqual(entry.path.length, 500);
  assert.strictEqual(entry.userAgent.length, 500);
});

test('a NUL character a request carries is left out, never a reason to refuse the line', async () => {
  await recordApiUse({ method: 'GET', path: '/api/now', query: { name: 'Nul\u0000Name' }, status: 200, duration: 1, ip: '203.0.113.13', userAgent: 'a\u0000b', name: '' });
  const entry = (await loadAccessLogs(1))[0];
  assert.strictEqual(entry.userAgent, 'ab');
  assert.strictEqual(entry.query.name, 'NulName');
});

test('the newest lines are read first, across days', async () => {
  await seedApiLines([
    { timestamp: '2026-01-01T23:59:59.000Z', method: 'GET', path: '/api/now', status: 200, ip: '203.0.113.20' },
    { timestamp: '2026-01-02T00:00:01.000Z', method: 'GET', path: '/api/attend', status: 200, ip: '203.0.113.20' },
  ]);
  const all = await loadAccessLogs(1000);
  const [later, earlier] = all.filter(e => e.timestamp.startsWith('2026-01-0'));
  assert.deepStrictEqual([later.path, earlier.path], ['/api/attend', '/api/now'], 'newest first, across the day\'s turn');
});

test('lines wait to be sent in one batch, and flush sends them', async () => {
  await flush();
  const before = (await store.apiRequests()).length;
  for (const i of [1, 2, 3]) recordApiUse({ method: 'GET', path: '/api/music', status: 200, duration: i, ip: '203.0.113.30', name: '' });
  assert.strictEqual((await store.apiRequests()).length, before, 'not yet sent');
  await flush();
  assert.strictEqual((await store.apiRequests()).length, before + 3);
});

test('each finished day is summarized by the hour, then its addresses are forgotten after 30 days, its rows kept, and nothing forgotten before it is counted', async () => {
  await resetDb();
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const oldDay = new Date(now - 40 * DAY);
  const recentDay = new Date(now - 20 * DAY);
  const at = (date, h) => new Date(`${date.toISOString().slice(0, 10)}T${String(h).padStart(2, '0')}:15:00.000Z`).toISOString();
  const line = (timestamp, ip, extra = {}) => ({ timestamp, method: 'GET', path: '/api/attend', status: 200, ip, userAgent: 'x', tool: 'attend', ...extra });
  await seedApiLines([
    line(at(oldDay, 9), '198.51.100.1', { timezone: 'Asia/Tokyo' }),
    line(at(oldDay, 9), '198.51.100.2', { timezone: 'Asia/Tokyo' }),
    line(at(oldDay, 9), '198.51.100.1', { timezone: 'Asia/Tokyo' }),
    line(at(oldDay, 14), '198.51.100.1'),
    line(at(recentDay, 9), '198.51.100.3'),
  ]);

  const { summarized, forgotten } = await forgetAddresses({ log: { log() {} } });
  const oldKey = oldDay.toISOString().slice(0, 10);
  const recentKey = recentDay.toISOString().slice(0, 10);
  assert.ok(summarized.includes(`api ${oldKey}`) && summarized.includes(`api ${recentKey}`), summarized.join(', '));
  assert.strictEqual(forgotten, 4, 'the old day\'s four rows');

  const rows = await store.apiRequests();
  const old = rows.filter(r => r.timestamp.startsWith(oldKey));
  assert.strictEqual(old.length, 4, 'every row kept');
  for (const r of old) {
    assert.ok(!('ip' in r), 'its address gone');
    assert.deepStrictEqual([r.path, r.tool, r.userAgent], ['/api/attend', 'attend', 'x'], 'its other fields kept');
  }
  assert.strictEqual(rows.find(r => r.timestamp.startsWith(recentKey)).ip, '198.51.100.3', 'a recent day keeps its addresses');

  // The hours, counted while the addresses were there, by the visitor's own clock too.
  const { data: hours } = await db().from('api_hourly').select('*').gte('hour', `${oldKey}T00:00:00Z`).lt('hour', `${oldKey}T23:59:59Z`).order('hour');
  const nine = hours.find(h => h.hour.startsWith(`${oldKey}T09`) && h.timezone === 'Asia/Tokyo');
  assert.deepStrictEqual([nine.requests, nine.attends, nine.addresses, nine.local_hour], [3, 3, 2, 18], '09:00 UTC is 18:00 in Tokyo');
  assert.strictEqual(nine.local_date, oldKey);
  const { data: daily } = await db().from('api_daily_addresses').select('*').eq('day', oldKey);
  assert.deepStrictEqual([daily[0].addresses, daily[0].requests], [2, 4], 'a day\'s distinct addresses, not its hours\' added');

  assert.deepStrictEqual((await forgetAddresses({ log: { log() {} } })).forgotten, 0, 'nothing left to forget');
  assert.deepStrictEqual((await forgetAddresses({ log: { log() {} } })).summarized, [], 'each day summarized once');
});

test('a day not yet summarized keeps its addresses, however old', async () => {
  await resetDb();
  const old = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
  await seedApiLines([{ timestamp: old, method: 'GET', path: '/api/now', status: 200, ip: '198.51.100.9' }]);
  assert.strictEqual(await store.forgetAddresses(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)), 0);
  assert.strictEqual((await store.apiRequests())[0].ip, '198.51.100.9');
  await flush();
});
