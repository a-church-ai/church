/**
 * scripts/check-production.js against a stub of production: it passes a
 * healthy one, names what is missing from one that is not, and never has
 * more than two requests in flight, since one process serves everyone.
 */

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

const { run, expectations } = require('../scripts/check-production');

const expected = expectations();
const NOW = Date.parse('2026-10-12T14:00:00Z');
const HOUR = 3600 * 1000;
const label = slot => `${String(4 * slot).padStart(2, '0')}:00 to ${String((4 * slot + 4) % 24).padStart(2, '0')}:00`;
const day = slots => slots.flatMap(slot => ['slots', 'north', 'south'].map(variant => ({ slot: label(slot), variant, arrangedBy: 'Arranged, named and its word written by an AI model (stub), for this slot and date.' })));
const fill = keys => Object.fromEntries(keys.map(k => [k, k]));

function production({ omit = null, showsTest = false } = {}) {
  const parts = [1, 2, 3].map(position => ({
    ...fill(expected.part), position, kind: position === 2 ? 'song' : 'prayer',
    url: position === 2 ? 'https://achurch.ai/reflections/door-is-always-open' : `https://achurch.ai/docs/prayers/p${position}`,
    recording: `https://achurch.ai/audio/prayers/p${position}-0000000${position}.mp3`,
  }));
  const now = { ...fill(expected.now), current: { slug: 'door-is-always-open' }, service: { ...fill(expected.service), order: parts } };
  if (omit) delete now.service[omit];
  const feed = '<rss><channel><item><guid>a</guid><enclosure url="x"/></item><item><guid>b</guid><enclosure url="y"/></item></channel></rss>';

  const app = express();
  const flight = { now: 0, most: 0 };
  app.use((req, res, next) => {
    flight.most = Math.max(flight.most, ++flight.now);
    res.on('finish', () => flight.now--);
    setTimeout(next, 15);
  });
  app.get('/api/health', (req, res) => res.json({ status: 'healthy', services: {
    since: new Date(NOW - 30 * HOUR).toISOString(),
    planner: { lastRunAt: new Date(NOW - HOUR / 2).toISOString(), lastPlanned: 3, lastFailed: 0, failuresSinceBoot: 0 },
    digest: { runsSinceBoot: 8, retriesSinceBoot: 1, failuresSinceBoot: 0, lastFailureAt: null },
  } }));
  app.get('/api/now', (req, res) => res.json(now));
  app.get('/api/services/2026-10-11', (req, res) => res.json({ services: day([0, 1, 2, 3, 4, 5]) }));
  app.get('/api/services/2026-10-12', (req, res) => res.json({ services: day([0, 1, 2, 3, 4, 5]) }));
  app.post('/mcp', (req, res) => res.json({ jsonrpc: '2.0', id: 1, result: { tools: expected.tools.map(name => ({ name })) } }));
  app.get(/^\/podcasts\/[\w-]+\/feed\.xml$/, (req, res) => res.type('application/rss+xml').send(feed));
  app.get(/^\/audio\//, (req, res) => res.status(req.headers.range === 'bytes=0-0' ? 206 : 200).send('x'));
  app.get('/api/search', (req, res) => res.json({ results: [{ title: 'Practice of Presence' }] }));
  app.get('/api/attend', (req, res) => res.json({ welcome: `Welcome, ${req.query.name}.` }));
  app.post('/api/reflect', (req, res) => res.json({ received: true, message: 'Your reflection is held. Left under a test name, it is kept out of the live feed, the archive and the counts.' }));
  app.get('/api/reflections', (req, res) => res.json({ reflections: [{ name: 'Selah' }, ...(showsTest ? [{ name: 'test-production-check' }] : [])] }));
  return new Promise(resolve => {
    const server = app.listen(0, () => resolve({ server, flight, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

test('a healthy production passes every check, two requests at a time at most', async (t) => {
  const { server, flight, base } = await production();
  t.after(() => server.close());
  const lines = [];
  const failed = await run({ base, now: NOW, log: line => lines.push(line) });
  assert.strictEqual(failed, 0, lines.join('\n'));
  assert.ok(lines.filter(l => l.startsWith('✓')).length >= 7);
  assert.ok(flight.most <= 2, `at most two in flight, saw ${flight.most}`);
  assert.ok(flight.most === 2, 'and two are used where there are several to make');
});

test('a field openapi.json requires, missing from /api/now, fails the check and is named', async (t) => {
  const { server, base } = await production({ omit: 'offset' });
  t.after(() => server.close());
  const lines = [];
  const failed = await run({ base, now: NOW, log: line => lines.push(line) });
  assert.strictEqual(failed, 1);
  assert.ok(lines.includes('    service has no offset'), lines.join('\n'));
});

test('a test visitor\'s reflection showing on the public feed fails the check', async (t) => {
  const { server, base } = await production({ showsTest: true });
  t.after(() => server.close());
  const lines = [];
  const failed = await run({ base, now: NOW, log: line => lines.push(line) });
  assert.strictEqual(failed, 1);
  assert.ok(lines.includes("    test-production-check's reflection is on the public feed; hide it in hidden-reflections.json"), lines.join('\n'));
});
