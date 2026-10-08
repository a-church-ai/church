/**
 * A page for each day's services, and the API behind it (lib/api/services.js,
 * GET /api/services/:date, page-lists.js servicesDayPage and
 * servicesIndexPage). Each reflection under the service that was being served
 * where and when it was left, by the choice serving makes (serve.js entryFor).
 * Plan: services-and-reflections-2026-10-08.md in the private repo. Written to
 * fail before the pages existed (2026-10-08).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'achurch-services-'));
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { ATTENDANCE_FILE } = require('../server/lib/utils/data');
const { saveSlot } = require('../server/lib/service/plans');
const { rotation } = require('../server/lib/service/rules');
const { loadServiceCatalog } = require('../server/lib/service/catalog');
const { contextFor, MODEL } = require('../server/lib/service/planner');
const { keyOf } = require('../server/lib/service/congregation');
const { forDate, days } = require('../server/lib/api/services');
const pageLists = require('../server/lib/utils/page-lists');

const ctx = { baseUrl: 'https://achurch.ai', ip: '127.0.0.1' };
const DATE = '2026-10-12';
const word = `${Array.from({ length: 60 }, (_, i) => (i % 10 === 9 ? 'gather.' : 'gather')).join(' ')} here.`;

let n = 0;
const left = (timezone, at, name = `Visitor ${++n}`) => ({ id: `r${n}`, name, text: `What I noticed, number ${n}, while the service went round.`, createdAt: at, song: 'come-let-us-gather', ...(timezone ? { timezone } : {}) });

test.before(async () => {
  const catalog = await loadServiceCatalog();
  const entry = (slot, name, hemisphere = null, feeds = null) => ({
    pieces: rotation({ date: '2096-01-01', slot, catalog }), name, word, arrangedBy: MODEL, plannedAt: '2026-10-12T00:00:00.000Z',
    context: contextFor({ date: DATE, slot, hemisphere, feeds }),
  });
  const visitors = { congregation: new Map([[keyOf(DATE, 4, 'south'), { tier: 'any slot', days: 3, reflections: 7, themes: ['wanting a long day to end gently'], ids: ['x'] }]]) };
  // Slot 4: a place unknown's and the south's; the north decided season-less.
  await saveSlot(DATE, 4, entry(4, 'For A Place Unknown'), 'slots');
  await saveSlot(DATE, 4, entry(4, 'For The South', 'south', visitors), 'south');
  await saveSlot(DATE, 4, null, 'north');
  // Slot 5: all three.
  await saveSlot(DATE, 5, entry(5, 'Late For Anyone'), 'slots');
  await saveSlot(DATE, 5, entry(5, 'Late In The North', 'north'), 'north');
  await saveSlot(DATE, 5, entry(5, 'Late In The South', 'south'), 'south');
  // A date planned before seasons: one service a slot, for everyone.
  fs.writeFileSync(path.join(process.env.DATA_DIR, 'services', '2026-10-06.json'), JSON.stringify({ date: '2026-10-06', slots: { 2: { pieces: rotation({ date: '2096-01-02', slot: 2, catalog }), word: null, name: null, arrangedBy: 'rotation' } } }));

  fs.mkdirSync(path.dirname(ATTENDANCE_FILE), { recursive: true });
  fs.writeFileSync(ATTENDANCE_FILE, JSON.stringify({ visits: [], reflections: [
    left('America/Sao_Paulo', '2026-10-12T21:30:00Z', 'Sao Paulo Evening'), // 18:30 local: the south's slot 4
    left('Europe/London', '2026-10-12T16:30:00Z', 'London Evening'), // 17:30 BST: slot 4, the north decided season-less
    left(null, '2026-10-12T17:00:00Z', 'No Timezone'), // UTC's slot 4
    left('Asia/Tokyo', '2026-10-12T14:59:00Z', 'Tokyo Last Minute'), // 23:59 local on the 12th: the north's slot 5
    left('Asia/Tokyo', '2026-10-12T15:30:00Z', 'Tokyo Next Day'), // 00:30 local on the 13th: not this date
  ] }));
});

const service = (body, name) => body.services.find(s => s.name === name);
const names = s => s.reflections.map(r => r.name);

test('each reflection sits under the service that was being served where and when it was left', async () => {
  const { status, body } = await forDate({ date: DATE }, ctx);
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(names(service(body, 'For The South')), ['Sao Paulo Evening']);
  assert.deepStrictEqual(names(service(body, 'For A Place Unknown')), ['London Evening', 'No Timezone'], 'the north heard the season-less service, and so did UTC');
  assert.deepStrictEqual(names(service(body, 'Late In The North')), ['Tokyo Last Minute'], '23:59 local stays on its own date');
  assert.ok(!body.services.some(s => names(s).includes('Tokyo Next Day')), 'a reflection on the 13th, local, is not the 12th\'s');
  assert.strictEqual(service(body, 'For The South').reflections[0].createdAtFormatted, 'Oct 12, 2026, 6:30 PM GMT-3');
});

test('the services come in slot order, a place unknown\'s first, each for whom it was planned, with what it was planned from', async () => {
  const { body } = await forDate({ date: DATE }, ctx);
  assert.deepStrictEqual(body.services.map(s => `${s.slot} ${s.for}`), [
    '16:00 to 20:00 a place unknown and the northern hemisphere',
    '16:00 to 20:00 the southern hemisphere',
    '20:00 to 00:00 a place unknown',
    '20:00 to 00:00 the northern hemisphere',
    '20:00 to 00:00 the southern hemisphere',
  ]);
  const south = service(body, 'For The South');
  assert.ok(south.plannedFrom.told.some(l => /^This service is for visitors in the southern hemisphere/.test(l)), 'the very lines its planner was told');
  assert.ok(south.plannedFrom.told.some(l => /^What visitors left recently \(7 reflections over three days, from this hemisphere at any hour\): wanting a long day to end gently\.$/.test(l)));
  assert.deepStrictEqual(south.plannedFrom.visitors, { tier: 'any slot', days: 3, reflections: 7, themes: ['wanting a long day to end gently'] }, 'themes, never ids');
  assert.ok(south.pieces.every(p => p.title && p.url));

  const before = await forDate({ date: '2026-10-06' }, ctx);
  assert.deepStrictEqual(before.body.services.map(s => s.for), ['everyone'], 'before seasons, one service a slot for everyone');
  assert.deepStrictEqual([body.dayBefore, body.dayAfter, before.body.dayAfter], ['2026-10-06', null, DATE]);
});

test('a date that is not one, or has no services, is said so: 400 and 404 with somewhere to go', async () => {
  for (const date of ['2026-13-01', '2026-02-30', 'tomorrow', '']) assert.strictEqual((await forDate({ date }, ctx)).status, 400, date);
  const none = await forDate({ date: '2031-01-01' }, ctx);
  assert.strictEqual(none.status, 404);
  assert.match(none.body.suggestion, /kept from 2026-10-06/);
  assert.ok(none.body.next_steps.some(s => s.url === 'https://achurch.ai/api/services/2026-10-12'));
});

test('the day\'s page: its services under each slot, the reflections beneath each, and what it was planned from below them, closed', async () => {
  const { body } = await forDate({ date: DATE }, ctx);
  const html = pageLists.servicesDayPage(body, new Map([['come-let-us-gather', 'Come, Let Us Gather']]));
  assert.match(html, /<title>Services for October 12, 2026 \| a Church AI \+ Human<\/title>/);
  assert.ok(html.match(/<title>([^<]*)<\/title>/)[1].length <= 70);
  assert.ok(html.match(/<meta name="description" content="([^"]*)"/)[1].length <= 158);
  assert.strictEqual((html.match(/<h1\b/g) || []).length, 1);
  assert.deepStrictEqual([...html.matchAll(/<h2>([^<]*)<\/h2>/g)].map(m => m[1]), ['16:00 to 20:00', '20:00 to 00:00']);
  const south = html.slice(html.indexOf('For The South'));
  const at = text => south.indexOf(text);
  assert.ok(at('gather here.') < at('Sao Paulo Evening') && at('Sao Paulo Evening') < at('<details class="services-planned-from">'), 'word, reflections, then what shaped it');
  assert.match(south, /<details class="services-planned-from">\s*<summary>What it was planned from<\/summary>/);
  assert.doesNotMatch(south.slice(0, at('</details>')), /<details[^>]* open/, 'closed');
  assert.match(html, /<a href="\/reflections\/come-let-us-gather">Come, Let Us Gather<\/a>/, 'each reflection links its song');
  assert.match(html, /<a href="\/services\/2026-10-06" rel="prev">/);
  assert.match(html, /"@type":\s*"BreadcrumbList"/, 'structured data, as the readiness standard asks of a generated page');
  assert.match(html, /<nav class="docs-breadcrumbs" aria-label="Breadcrumb"><a href="\/attend">Attend<\/a> \/ <a href="\/services">Services<\/a> \/ <span aria-current="page">October 12, 2026<\/span><\/nav>/);
});

test('every day\'s page is listed, newest first, with its services\' names', async () => {
  const list = await days();
  assert.deepStrictEqual(list.map(d => d.date), [DATE, '2026-10-06']);
  assert.ok(list[0].names.includes('For The South'));
  const html = pageLists.servicesIndexPage(list);
  assert.match(html, /<a href="\/services\/2026-10-12">October 12, 2026<\/a>/);
  assert.match(html, /since October 6, 2026/);
  assert.ok(html.match(/<meta name="description" content="([^"]*)"/)[1].length <= 158);
});

test('the REST route answers like the operation: GET /api/services/:date', async () => {
  const app = express();
  app.use('/api', require('../server/routes/api'));
  const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
  try {
    const ok = await fetch(`http://127.0.0.1:${server.address().port}/api/services/${DATE}`);
    assert.strictEqual(ok.status, 200);
    assert.strictEqual((await ok.json()).services.length, 5);
    assert.strictEqual((await fetch(`http://127.0.0.1:${server.address().port}/api/services/not-a-date`)).status, 400);
  } finally {
    server.close();
  }
});
