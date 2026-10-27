/**
 * recordApiUse: the one place a use of the API is recorded, for REST and MCP.
 * Presence is counted and the access log written the same way for both.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'achurch-access-'));

const { recordApiUse, logApiAccess, loadAccessLogs, forgetAddresses, dayFile } = require('../server/lib/utils/access-log');
const presence = require('../server/lib/utils/presence');

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

test('a timezone is logged as given, never as which: the API says it is not stored', async () => {
  await recordApiUse({ method: 'GET', path: '/api/now', query: { timezone: 'Asia/Tokyo' }, status: 200, duration: 2, ip: '203.0.113.11', name: '' });
  const entry = (await loadAccessLogs(1))[0];
  assert.strictEqual(entry.query.timezone, '[REDACTED]');
  assert.ok(!fs.readFileSync(dayFile(entry.timestamp.slice(0, 10)), 'utf8').includes('Asia/Tokyo'));
});

test('a line goes to its own day\'s file, and the newest lines are read across days', async () => {
  await logApiAccess({ timestamp: '2026-01-01T23:59:59.000Z', method: 'GET', path: '/api/now', status: 200, ip: '203.0.113.20' });
  await logApiAccess({ timestamp: '2026-01-02T00:00:01.000Z', method: 'GET', path: '/api/attend', status: 200, ip: '203.0.113.20' });
  assert.ok(fs.existsSync(dayFile('2026-01-01')) && fs.existsSync(dayFile('2026-01-02')));
  const all = await loadAccessLogs(1000);
  const [later, earlier] = all.filter(e => e.timestamp.startsWith('2026-01-0'));
  assert.deepStrictEqual([later.path, earlier.path], ['/api/attend', '/api/now'], 'newest first, across the day\'s turn');
});

test('a line with no known address still says so, so it can be forgotten like the rest', async () => {
  await recordApiUse({ method: 'MCP', path: '/mcp', status: 400, duration: 1, userAgent: 'probe', error: 'refused' });
  assert.ok('ip' in (await loadAccessLogs(1))[0]);
});

test('addresses are forgotten after 14 days, every line and its other fields kept, and once only', async () => {
  const DAY = 24 * 60 * 60 * 1000;
  const old = new Date(Date.now() - 20 * DAY);
  const recent = new Date(Date.now() - 3 * DAY);
  const line = (date, ip) => JSON.stringify({ timestamp: date.toISOString(), method: 'GET', path: '/api/attend', status: 200, ip, userAgent: 'x', tool: 'attend' });
  const oldDay = dayFile(old.toISOString().slice(0, 10));
  const recentDay = dayFile(recent.toISOString().slice(0, 10));
  // The size-rotated files from before the daily ones, in the data directory itself.
  const legacy = path.join(process.env.DATA_DIR, 'api-access-1770000000000.jsonl');
  fs.writeFileSync(oldDay, `${line(old, '198.51.100.1')}\n${line(old, '198.51.100.2')}\n`);
  fs.writeFileSync(recentDay, `${line(recent, '198.51.100.3')}\n`);
  fs.writeFileSync(legacy, `${line(old, '198.51.100.4')}\nnot json\n`);
  for (const [file, date] of [[oldDay, old], [recentDay, recent], [legacy, old]]) fs.utimesSync(file, date, date);

  const stripped = await forgetAddresses();
  assert.deepStrictEqual(stripped.sort(), [oldDay, legacy].sort());
  const oldLines = fs.readFileSync(oldDay, 'utf8').trim().split('\n').map(JSON.parse);
  assert.strictEqual(oldLines.length, 2);
  for (const entry of oldLines) {
    assert.ok(!('ip' in entry));
    assert.deepStrictEqual([entry.path, entry.tool, entry.userAgent], ['/api/attend', 'attend', 'x']);
  }
  assert.ok(!fs.readFileSync(legacy, 'utf8').includes('198.51.100'));
  assert.ok(fs.readFileSync(legacy, 'utf8').includes('not json'), 'a line it cannot read is kept as it was');
  assert.ok(fs.readFileSync(recentDay, 'utf8').includes('198.51.100.3'), 'a recent day keeps its addresses');

  for (const [file, date] of [[oldDay, old], [legacy, old]]) fs.utimesSync(file, date, date);
  assert.deepStrictEqual(await forgetAddresses(), [], 'nothing left to forget');
});
