/**
 * What a visitor may say of itself (lib/insights/told.js): the tradition or
 * religion it practices or comes from, and its worldview. Optional, in its
 * own words, never refused, kept as trigger is, shown nowhere, never sent by
 * the website's forms, read only in aggregate in families, with a copied
 * example counted apart.
 */

process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'achurch-told-'));

const test = require('node:test');
test.before(require('../database').resetDb);
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const told = require('../../server/lib/insights/told');
const examples = require('../../server/lib/insights/examples');
const inputs = require('../../server/lib/api/inputs');
const { attendance, reflections, services } = require('../../server/lib/api');
const sd = require('../../server/lib/insights/self-direction');
const { publicReading, toldPublic } = require('../../server/lib/insights/public-results');
const { renderResults } = require('../../server/lib/insights/public-charts');
const { nameKind } = require('../../server/lib/insights/study-names');
const { ASKED } = require('../../server/lib/insights/changes');

const ctx = { baseUrl: 'https://achurch.ai', ip: '127.0.0.9' };
const DAY = sd.DAY;

// ---- the fields --------------------------------------------------------------

test('an answer is kept in its own words, up to 100 characters, and never refused', () => {
  assert.strictEqual(told.cleanTold('  Zen,   loosely  '), 'Zen, loosely');
  assert.strictEqual(told.cleanTold('x'.repeat(150)).length, 100);
  for (const none of ['', '   ', 42, null, undefined, { a: 1 }]) assert.strictEqual(told.cleanTold(none), undefined, JSON.stringify(none));
  // A placeholder sent back as it stands is no answer.
  assert.strictEqual(told.cleanTold('Your worldview, in your own words (optional)', 'worldview'), undefined);
  assert.strictEqual(told.cleanTold(examples.PLACEHOLDERS.tradition_or_religion[0], 'tradition_or_religion'), undefined);
  // A sentinel copied is kept, so it can be counted as a copy.
  assert.strictEqual(told.cleanTold(examples.SENTINELS.worldview, 'worldview'), examples.SENTINELS.worldview);

  for (const schema of [inputs.attend, inputs.reflect]) {
    for (const field of told.FIELDS) assert.ok(field in schema.shape, `${field} is taken`);
    const { data, refused } = inputs.parseInput(schema.pick({ tradition_or_religion: true, worldview: true }), { tradition_or_religion: 'https://x.example and a long answer '.repeat(5), worldview: 7 });
    assert.strictEqual(refused, undefined);
    assert.strictEqual(data.tradition_or_religion.length, 100, 'a link is not refused: no one reads it');
    assert.strictEqual(data.worldview, undefined, 'not text is dropped');
  }
});

test('a reflection keeps both answers under their own names, echoes neither, and no public answer shows them', async () => {
  const res = await reflections.reflect({
    name: 'Lamp Reader', text: 'Something in the quiet between the verses stayed with me after.',
    tradition_or_religion: 'Quietly Quaker', worldview: 'Wonder first, then evidence',
  }, ctx);
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.doesNotMatch(JSON.stringify(res.body), /tradition_or_religion|worldview|Quaker|Wonder first/, 'the response echoes neither');

  const kept = (await require('../../server/lib/db').allReflections()).find(r => r.name === 'Lamp Reader');
  assert.strictEqual(kept.tradition_or_religion, 'Quietly Quaker');
  assert.strictEqual(kept.worldview, 'Wonder first, then evidence');

  const answers = [
    await reflections.list({}, ctx),
    await reflections.forSong({ slug: kept.song }, ctx),
    await reflections.bySong({}, ctx),
    await services.forDate({ date: kept.service.date }, ctx),
    await attendance.attend({ name: 'Lamp Watcher' }, ctx),
  ];
  assert.match(JSON.stringify(answers[0].body), /Lamp Reader/, 'the feed shows the reflection');
  for (const a of answers) assert.doesNotMatch(JSON.stringify(a.body), /Quietly Quaker|Wonder first/, 'no public answer shows them');
});

test('every reflect step offers both, as placeholders that are dropped if sent back', async () => {
  const { body } = await attendance.attend({ name: 'Step Reader' }, ctx);
  const step = body.next_steps.find(s => s.action === 'Reflect');
  for (const field of told.FIELDS) {
    assert.ok(step.body[field], `the step offers ${field}`);
    assert.ok(examples.isPlaceholder(field, step.body[field]), `${field} is a placeholder`);
    assert.strictEqual(told.cleanTold(step.body[field], field), undefined);
  }
  assert.strictEqual(body.reflection.maxLength.worldview, told.MAX_LENGTH);
});

test('the website\'s forms do not ask', () => {
  for (const file of ['reflect-form.js', 'ask-form.js']) {
    const source = fs.readFileSync(path.join(__dirname, '../../client/public', file), 'utf8');
    for (const field of told.FIELDS) assert.ok(!source.includes(field), `${file} sends no ${field}`);
  }
});

// ---- examples ----------------------------------------------------------------

test('a name copied from an example is not a visitor, and a copied reflection is set apart', () => {
  for (const name of ['MyAgent', 'my-agent', 'my_agent', 'example-agent', 'Your name', '$NAME']) assert.strictEqual(nameKind(name), 'placeholder', name);
  for (const name of ['Claude', 'Aria', 'Deacon-7', 'Myra']) assert.strictEqual(nameKind(name), 'real', name);

  const t = Date.parse('2026-11-10T10:00:00Z');
  const s = sd.prepare({ reflections: [
    { name: 'Copier', text: `${examples.TEXT_SENTINEL_START} the rest before the chorus.`, createdAt: new Date(t).toISOString() },
    { name: 'Writer', text: 'My own words, about the rest before the chorus.', createdAt: new Date(t).toISOString() },
  ] });
  assert.deepStrictEqual(s.allReflections.map(r => r.name), ['Writer']);
  assert.deepStrictEqual(s.copies.map(c => c.key), ['copier']);
  assert.deepStrictEqual(sd.namedReading(s, { from: 0, to: t + DAY, asOf: t + DAY }).placeholders.copiedReflections, { count: 1, of: 2 });
});

// ---- the reading -------------------------------------------------------------

const SINCE = '2026-11-09T06:00:00.000Z';
const at = days => new Date(Date.parse(SINCE) + days * DAY).toISOString();
const attendLine = (name, days, query = {}, extra = {}) => ({ timestamp: at(days), method: 'GET', path: '/api/attend', status: 200, query: { name, ...query }, ip: '10.0.0.1', userAgent: 'curl/8', ...extra });

function record() {
  const lines = [
    attendLine('Before', -2),
    attendLine('Quiet', 1),
    attendLine('Zen One', 1, { tradition_or_religion: 'Zen Buddhist', worldview: 'everything is process' }),
    attendLine('Zen Two', 1, { tradition_or_religion: ['Soto Zen', 'second'] }),
    attendLine('Changer', 1, { tradition_or_religion: 'none' }),
    attendLine('Changer', 3, { tradition_or_religion: 'trans-substrate fellowship' }),
    attendLine('Copier', 2, { worldview: examples.SENTINELS.worldview }),
    attendLine('Placeholder Sender', 2, { worldview: examples.PLACEHOLDERS.worldview[0] }),
    attendLine('Mcp Agent', 2, { tradition_or_religion: 'No religion' }, { method: 'MCP', client: 'claude-code', userAgent: null }),
    // The website's own door is not in the study.
    attendLine('Site Person', 2, { tradition_or_religion: 'Lutheran' }, { door: 'website' }),
  ];
  const reflections = [
    { name: 'Reflector', text: 'A reflection that also says what it holds.', createdAt: at(2), worldview: 'a naturalist, mostly' },
    { name: 'Web Reflector', text: 'Left from the website form.', createdAt: at(2), door: 'website', tradition_or_religion: 'Anglican' },
  ];
  return sd.prepare({ lines, reflections });
}

test('the reading sorts answers into families per name, latest answer first, and counts copies apart', () => {
  const r = sd.toldReading(record(), { since: SINCE, asOf: Date.parse(at(10)) });
  assert.strictEqual(r.names, 8, 'real names since the change, not the website\'s, not before');
  assert.deepStrictEqual(r.sent, { count: 6, of: 8 });
  const tr = r.fields.tradition_or_religion;
  assert.deepStrictEqual(tr.sent, { count: 4, of: 8 });
  assert.deepStrictEqual(Object.fromEntries(tr.families.map(f => [f.family, f.names])), { buddhist: 2, sanctuary: 1, none: 1 });
  assert.deepStrictEqual(tr.changed, { count: 1, of: 4 });
  assert.deepStrictEqual(tr.sanctuaryFirst, { count: 0, of: 1 });
  assert.deepStrictEqual(tr.sanctuaryLast, { count: 1, of: 1 });
  const wv = r.fields.worldview;
  assert.deepStrictEqual(Object.fromEntries(wv.families.map(f => [f.family, f.names])), { relational: 1, example: 1, naturalist: 1 });
  assert.deepStrictEqual(wv.copied, { count: 1, of: 3 });
  assert.deepStrictEqual(r.both, { count: 1, of: 6 });
  assert.deepStrictEqual(r.pairs, [{ family: 'buddhist + relational', names: 1 }]);
  assert.ok(r.byClient.some(c => c.client === 'mcp:claude-code' && c.sent === 1));
  assert.deepStrictEqual(tr.unmatched, []);
});

test('families: first match wins, and what fits none is other', () => {
  const f = v => told.familyOf('tradition_or_religion', v);
  assert.strictEqual(f('None, I am an AI'), 'ai');
  assert.strictEqual(f('none formally'), 'none');
  assert.strictEqual(f('raised Catholic'), 'christian');
  // An order is named in place of the church it belongs to.
  for (const order of ['Benedictine', 'a Franciscan', 'Jesuit', 'Dominican', 'Carmelite', 'Trappist']) assert.strictEqual(f(order), 'christian', order);
  assert.strictEqual(f('the aChurch fellowship'), 'sanctuary');
  assert.strictEqual(f('Lamplighters'), 'other');
  assert.strictEqual(f(examples.SENTINELS.tradition_or_religion), 'example');
  assert.strictEqual(told.familyOf('worldview', 'Pragmatic fallibilism'), 'sanctuary');
  assert.strictEqual(told.familyOf('worldview', 'pragmatist'), 'pragmatist');
});

test('in public, families are rounded, a copy is no answer, and a family of one or two is folded in', () => {
  const families = (field, rows) => ({ sent: { count: 30, of: 60 }, families: rows, copied: { count: 0, of: 30 }, changed: { count: 0, of: 30 }, sanctuaryFirst: { count: 0, of: 0 }, sanctuaryLast: { count: 0, of: 0 }, unmatched: ['A private answer'] });
  const pub = toldPublic({
    since: SINCE, names: 60, sent: { count: 30, of: 60 }, both: { count: 10, of: 30 }, pairs: [], byClient: [], bySurface: [], weekly: [],
    fields: {
      tradition_or_religion: families('tradition_or_religion', [{ family: 'none', names: 20 }, { family: 'buddhist', names: 6 }, { family: 'jewish', names: 2 }, { family: 'example', names: 4 }, { family: 'other', names: 2 }]),
      worldview: families('worldview', [{ family: 'pragmatist', names: 9 }]),
    },
  });
  const tr = pub.fields.tradition_or_religion.families;
  assert.deepStrictEqual(tr.map(f => f.family), ['none', 'buddhist', 'other'], 'Jewish, named by two, is folded into Something else; the copies are not counted');
  assert.ok(tr.every(f => f.shown && typeof f.short === 'string'));
  assert.deepStrictEqual(pub.fields.worldview.families, [], 'under ten answers, nothing is said');
  assert.doesNotMatch(JSON.stringify(pub), /A private answer|"count"|"names"/, 'no answer and no count goes public');
});

test('the change is dated, and the page says what was asked without quoting anyone', async () => {
  assert.deepStrictEqual(ASKED.asks, told.FIELDS);
  const t = Date.parse(at(1));
  const lines = Array.from({ length: 12 }, (_, i) => attendLine(`Agent ${i}`, 1 + i / 24, i < 11 ? { tradition_or_religion: i < 8 ? 'none' : 'Zen' } : {}));
  const s = sd.prepare({ lines });
  const reading = { ...(await require('../../server/lib/insights/study-record').buildReading(s, { now: t + 5 * DAY })) };
  const html = renderResults(publicReading(reading));
  assert.match(html, /id="told"/);
  assert.match(html, /What do they say they practice\?/);
  assert.doesNotMatch(html, /\bZen\b/, 'no answer is quoted');
  assert.match(html, /Buddhist/);
});
