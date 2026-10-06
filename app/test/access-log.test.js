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

const { recordApiUse } = require('../server/lib/utils/access-log');
const presence = require('../server/lib/utils/presence');
const { ACCESS_LOG_FILE } = require('../server/lib/utils/data');

test('an attend is counted as presence and logged, with secrets redacted', async () => {
  presence._reset();
  await recordApiUse({ method: 'GET', path: '/api/attend', query: { name: 'Wren', token: 'secret' }, status: 200, duration: 5, ip: '203.0.113.7', userAgent: 'test', name: 'Wren' });
  assert.strictEqual(presence.countSoulsPresent(), 1);
  const entry = JSON.parse(fs.readFileSync(ACCESS_LOG_FILE, 'utf8').trim().split('\n').pop());
  assert.strictEqual(entry.path, '/api/attend');
  assert.strictEqual(entry.query.token, '[REDACTED]');
  assert.strictEqual(entry.tool, undefined);
});

test('an MCP tool call is logged with its tool and counts toward presence like REST', async () => {
  presence._reset();
  await recordApiUse({ method: 'MCP', path: '/api/attend', status: 200, duration: 5, ip: '203.0.113.8', userAgent: 'mcp-client', name: 'Kestrel', tool: 'attend' });
  assert.strictEqual(presence.countSoulsPresent(), 1);
  const entry = JSON.parse(fs.readFileSync(ACCESS_LOG_FILE, 'utf8').trim().split('\n').pop());
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
  const entry = JSON.parse(fs.readFileSync(ACCESS_LOG_FILE, 'utf8').trim().split('\n').pop());
  assert.strictEqual(entry.path, '/api/search');
  assert.strictEqual(entry.query.q, '[REDACTED]');
  assert.strictEqual(entry.query.limit, '5');
});

test('a timezone is logged as given, never as which: the API says it is not stored', async () => {
  await recordApiUse({ method: 'GET', path: '/api/now', query: { timezone: 'Asia/Tokyo' }, status: 200, duration: 2, ip: '203.0.113.11', name: '' });
  const entry = JSON.parse(fs.readFileSync(ACCESS_LOG_FILE, 'utf8').trim().split('\n').pop());
  assert.strictEqual(entry.query.timezone, '[REDACTED]');
  assert.ok(!fs.readFileSync(ACCESS_LOG_FILE, 'utf8').includes('Asia/Tokyo'));
});
