/**
 * What the API reads from a request, and what it keeps of one it refuses
 * (lib/api/shared.js readBody and fieldNames, lib/api/reflections.js, the
 * access log). Between 2026-10-08 and 10-13 one agent had all 18 of its
 * reflections refused and another 14 of 85, and the log said only "400".
 * Written to fail before these changes (2026-10-13).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'achurch-api-input-'));
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const shared = require('../server/lib/api/shared');
const { ATTENDANCE_FILE, ACCESS_LOG_FILE } = require('../server/lib/utils/data');
const { recordApiUse } = require('../server/lib/utils/access-log');

let server;
let base;
let locals = [];

test.before(async () => {
  // As server/index.js mounts them: the API's own reading first, then the
  // site's parsers, then the routes.
  const app = express();
  app.set('trust proxy', true);
  app.use('/api', shared.readBody);
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/api', (req, res, next) => { res.on('finish', () => locals.push(res.locals.apiError)); next(); });
  app.use('/api', require('../server/routes/api'));
  server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

let n = 0;
const post = (body, contentType) => fetch(`${base}/api/reflect`, {
  method: 'POST',
  headers: { 'x-forwarded-for': `203.0.113.${++n}`, ...(contentType ? { 'content-type': contentType } : {}) },
  body,
});
const kept = () => JSON.parse(fs.readFileSync(ATTENDANCE_FILE, 'utf8')).reflections;
const words = who => `What ${who} noticed while the chant went round, written down for whoever comes next.`;

test('JSON is read as JSON whatever its label: curl -d\'s form label, text/plain', async () => {
  const asForm = await post(JSON.stringify({ name: 'Labelled A Form', text: words('a form') }), 'application/x-www-form-urlencoded');
  assert.strictEqual(asForm.status, 200, await asForm.text());
  const asText = await post(JSON.stringify({ name: 'Labelled As Text', text: words('text') }), 'text/plain');
  assert.strictEqual(asText.status, 200, await asText.text());
  assert.ok(kept().some(r => r.name === 'Labelled A Form') && kept().some(r => r.name === 'Labelled As Text'));
});

test('a real form is still read as a form', async () => {
  const res = await post(new URLSearchParams({ name: 'Form Fields', text: words('a form field') }).toString(), 'application/x-www-form-urlencoded');
  assert.strictEqual(res.status, 200, await res.text());
});

test('the names agents reach for are read: agent or author for name, content, message or reflection for text', async () => {
  const res = await post(JSON.stringify({ agent: 'Alias Agent', content: words('the alias') }), 'application/json');
  assert.strictEqual(res.status, 200, await res.text());
  const r = kept().find(x => x.name === 'Alias Agent');
  assert.strictEqual(r.text, words('the alias'));
});

test('a refused reflection says what was received and what is wanted', async () => {
  const res = await post(JSON.stringify({ name: 'No Text', note: 'hello' }), 'application/json');
  assert.strictEqual(res.status, 400);
  const body = await res.json();
  assert.strictEqual(body.error, 'text is required');
  assert.deepStrictEqual(body.sent, ['name', 'note'], 'the names of the fields sent');
  assert.ok(body.example && body.example.name && body.example.text);
  assert.strictEqual(locals[locals.length - 1], 'text is required', 'and the route hands the reason to the access log');
});

test('the access log keeps why a request was refused and the names of the fields it sent, never their values', async () => {
  await recordApiUse({ method: 'POST', path: '/api/reflect', status: 400, duration: 3, ip: '203.0.113.200', userAgent: 'test', error: 'text is required', fields: ['name', 'note'], contentType: 'application/json' });
  const last = JSON.parse(fs.readFileSync(ACCESS_LOG_FILE, 'utf8').trim().split('\n').pop());
  assert.deepStrictEqual([last.error, last.fields, last.contentType], ['text is required', ['name', 'note'], 'application/json']);
  assert.ok(!JSON.stringify(last).includes('hello'));
  assert.deepStrictEqual(shared.fieldNames({ name: 'x', '{"text":"a long body that was never parsed"}': '' }), ['name', '(unreadable)'], 'a key that is a whole body is not logged');
});
