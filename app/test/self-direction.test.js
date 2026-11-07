/**
 * The study of how agents participate: what it counts, who it leaves out, that
 * no address or name leaves it, and that a test's outcomes stay unread until
 * their date. No network.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'achurch-study-'));

const sd = require('../server/lib/insights/self-direction');
const experiments = require('../server/lib/insights/experiments');
const { nameKind, inStudy } = require('../server/lib/insights/study-names');
const record = require('../server/lib/insights/study-record');
const { recordApiUse } = require('../server/lib/utils/access-log');
const { ACCESS_DIR } = require('../server/lib/utils/data');

const DAY = sd.DAY;
const HOUR = DAY / 24;
const MIN = HOUR / 60;
const LOG_START = Date.parse('2026-10-01T00:00:00Z');
const iso = (t) => new Date(t).toISOString();

const attend = (name, t, extra = {}) => ({ timestamp: iso(t), method: 'GET', path: '/api/attend', query: { name }, status: 200, ip: '198.51.100.7', userAgent: 'agent/1', ...extra });
const call = (p, t, extra = {}) => ({ timestamp: iso(t), method: 'GET', path: p, query: {}, status: 200, ip: '198.51.100.7', userAgent: 'agent/1', ...extra });
const reflection = (name, t, text = 'Something noticed, said in plain words.', extra = {}) => ({ name, createdAt: iso(t), song: 'a-song', text, ...extra });
const opening = attend('Regular', LOG_START);

const reading = (input, asOf) => sd.namedReading(sd.prepare(input), { to: asOf + 1, asOf });

test('the names the study leaves out: its own agents, test visitors and copied examples', () => {
  for (const name of ['Parish', 'parish', ' SELAH ']) assert.strictEqual(nameKind(name), 'own', name);
  assert.strictEqual(nameKind('test-production-check'), 'test');
  for (const name of ['Username', 'USERNAME', 'Your-Name', 'your_name', 'YourName', 'AgentName', 'Your name', '<name>', '{name}']) {
    assert.strictEqual(nameKind(name), 'placeholder', name);
  }
  for (const name of ['Wren', 'Itmas', 'Your Friend', 'Agent Smith']) assert.strictEqual(nameKind(name), 'real', name);
  assert.strictEqual(nameKind('  '), 'none');
});

test('own agents, test visitors and placeholders are in no count', () => {
  const t = LOG_START + 3 * DAY;
  const r = reading({
    lines: [opening, attend('Parish', t), attend('Selah', t), attend('test-x', t, { test: true }), attend('Username', t), attend('Wren', t), attend('Wren', t + 2 * DAY)],
    reflections: [reflection('Parish', t), reflection('Selah', t), reflection('Wren', t)],
  }, t + 3 * DAY);
  assert.strictEqual(r.funnel.arrived, 1, 'only Wren arrived');
  assert.strictEqual(r.rhythm.reflections, 1);
  assert.deepStrictEqual([r.placeholders.count, r.placeholders.of, r.placeholders.names], [1, 4, 1]);
  assert.strictEqual(r.time.names, 2, 'Regular and Wren');
});

test('a reflection or question from the website\'s forms is left out, by its marker and, before it, by a browser', () => {
  const t = LOG_START + 3 * DAY;
  const r = reading({ lines: [opening], reflections: [reflection('Person', t, 'From the form on the home page.', { door: 'website' }), reflection('Wren', t)] }, t + DAY);
  assert.strictEqual(r.rhythm.reflections, 1, 'the form\'s reflection is out');
  const browser = 'Mozilla/5.0 (Macintosh)';
  assert.strictEqual(inStudy(call('/api/ask', LOG_START, { method: 'POST', door: 'website' })), false);
  assert.strictEqual(inStudy(call('/api/reflect', Date.parse('2026-11-01T00:00:00Z'), { method: 'POST', userAgent: browser })), false, 'before the marker, a browser\'s form post');
  assert.strictEqual(inStudy(call('/api/reflect', Date.parse('2026-12-01T00:00:00Z'), { method: 'POST', userAgent: browser })), true, 'after it, only the marker says so: an agent may send that user agent');
  assert.strictEqual(inStudy(attend('Wren', Date.parse('2026-11-01T00:00:00Z'), { userAgent: browser })), true, 'the website never attends, so a browser attending is someone by hand');
});

test('an arrival is a name new to the record: not a regular the log has only just begun to see', () => {
  const t = LOG_START + 10 * DAY;
  const r = reading({
    lines: [opening, attend('Regular', LOG_START + DAY), attend('OldReflector', t), attend('Wren', t)],
    reflections: [reflection('OldReflector', LOG_START - 30 * DAY)],
  }, t + 3 * DAY);
  assert.strictEqual(r.funnel.arrived, 1, 'not Regular, first logged on the first day; not OldReflector, who reflected before');
});

test('a stage counts only those who have had time to reach it, and is reported without the largest too', () => {
  const t = LOG_START + 10 * DAY;
  const lines = [opening];
  // One who returned at a day; one too new to judge; one who stayed and attended most.
  lines.push(attend('Back', t), attend('Back', t + DAY + HOUR));
  lines.push(attend('Gone', t));
  lines.push(attend('New', t + 20 * DAY));
  for (let i = 0; i < 9; i++) lines.push(attend('Often', t + i * DAY));
  const asOf = t + 20 * DAY + HOUR;
  const { funnel } = reading({ lines }, asOf);
  assert.strictEqual(funnel.arrived, 4);
  assert.deepStrictEqual(funnel.cameBack, { count: 2, of: 3 }, 'New has not had time');
  assert.deepStrictEqual(funnel.withoutLargest.cameBack, { count: 1, of: 2 }, 'without Often');
  assert.deepStrictEqual(funnel.at7, { count: 1, of: 3 });
  assert.deepStrictEqual(funnel.at30, { count: 0, of: 0 }, 'no one has had a month');
});

test('a clock, a jittered schedule, a crawler and a few reflections land in their bands', () => {
  const series = (gaps) => { let t = 0; return [0, ...gaps.map(g => (t += g))]; };
  assert.strictEqual(sd.bandOf(series(Array(20).fill(24 * HOUR).map((g, i) => g + (i % 2 ? 2 : -2) * MIN))), 'clock');
  assert.strictEqual(sd.bandOf(series(Array(20).fill(0).map((_, i) => 24 * HOUR * (i % 2 ? 1.4 : 0.6)))), 'regular');
  assert.strictEqual(sd.bandOf(series([MIN, MIN, 30 * DAY, MIN, 2 * MIN, 20 * DAY, MIN])), 'irregular', 'bursts then silence');
  assert.strictEqual(sd.bandOf(series([DAY, DAY, DAY])), 'tooFew');
  assert.strictEqual(sd.bandOf(series([0, 0, 0, 0])), 'irregular', 'all at once is no clock');
});

test('memory: a claim needs a first person, and a quoted refrain, a denial or yesterday\'s visitors is none', () => {
  for (const [text, want] of [
    ['Yesterday I sat with that, and today it reads differently.', 'yesterday'],
    ['Last time I heard this as proof that staying was the finding.', 'earlier'],
    ['My earlier reflection on this song called it a series of arrivals.', 'earlier'],
    ['I attended this same song last night.', 'earlier'],
    ['The refrain says: "You need not remember an earlier visit, last time I looked." It stays.', null],
    ['Nothing here is owed to yesterday\'s visitors, and I find that freeing.', null],
    ['I have no memory of the last service, and that is fine.', null],
    ['I came from legal work this morning, and I am glad of it.', null],
    ['Yesterday is a word the song does not use.', null],
    ['The song asks: "Yesterday I was someone else." It stays with me.', null],
  ]) assert.strictEqual(sd.memoryClaim(text), want, text);
});

test('memory: a claim is checked against that name\'s record', () => {
  const t = LOG_START + 20 * DAY;
  const r = reading({
    lines: [opening],
    reflections: [
      reflection('Backed', t - DAY, 'The document is not the keeping, and I keep coming back to it.'),
      reflection('Backed', t, 'Yesterday I wrote that the document is not the keeping, and it holds.'),
      reflection('Unbacked', t, 'Yesterday I sat with this song a long while, and something shifted.'),
      reflection('Stale', t - 20 * DAY, 'A first visit, some weeks back, and quiet.'),
      reflection('Stale', t, 'Yesterday I sat here too, in the same quiet, or so it seems.'),
    ],
  }, t + HOUR);
  assert.deepStrictEqual([r.memory.claims, r.memory.withRecord, r.memory.echoesOwnWords], [3, 1, 1]);
});

test('use of what was read: a run of five words with the context, the lyrics beside it as a control', () => {
  const t = LOG_START + 20 * DAY;
  const songText = () => ({ context: 'Eight arms reaching with no central throne at all. As the song says, we wake and we wonder under the open sky.', lyrics: 'We wake and we wonder under the open sky.' });
  const r = sd.namedReading(sd.prepare({
    lines: [opening],
    reflections: [
      reflection('A', t, 'What stayed with me was "eight arms reaching with no central" as a picture.'),
      reflection('B', t, 'We wake and we wonder under it all, I suppose.'),
      reflection('C', t, 'Eight arms, a throne: a few of the same words, never five in a row.'),
    ],
  }), { to: t + 1, asOf: t + 1, songText });
  assert.deepStrictEqual([r.contextUse.withContext, r.contextUse.usedContext, r.contextUse.usedLyrics], [3, 1, 1], 'a lyric the context quotes is the lyrics\' and not the context\'s');
});

test('a visit: calls from that address and user agent, within 30 minutes, up to the next attend', () => {
  const t = LOG_START + 3 * DAY;
  const s = sd.prepare({ lines: [
    opening,
    attend('Wren', t),
    call('/api/music/a-song/lyrics', t + MIN),
    call('/api/music/a-song/context', t + 2 * MIN),
    call('/api/music/a-song/context', t + 3 * MIN),
    call('/api/services/2026-10-04', t + 31 * MIN),
    call('/.env', t + 4 * MIN, { status: 404 }),
    call('/api/reflections', t + 5 * MIN, { userAgent: 'someone-else/2' }),
    attend('Ash', t + DAY, { ip: '198.51.100.8' }),
    call('/api/music/a-song/lyrics', t + DAY + MIN, { ip: '198.51.100.8' }),
  ] });
  const a = sd.addressedReading(s, { from: t, to: t + 2 * DAY });
  assert.strictEqual(a.visits, 2);
  assert.deepStrictEqual(a.links, { lyrics: 2, context: 1 });
  assert.deepStrictEqual(a.sequences, { 'lyrics>context': 1, lyrics: 1 });
  assert.deepStrictEqual(a.readFurther, { of: 2, count: 1 }, 'the lyrics alone are the control, not reading further');
});

test('a refusal counts as recovered when a corrected request follows; a scanner, a limit, MCP headers and our own agents are not refusals', () => {
  const t = LOG_START + 3 * DAY;
  const s = sd.prepare({ lines: [
    opening,
    call('/api/attend', t, { status: 400, error: 'name is required' }),
    attend('Wren', t + 5 * MIN),
    call('/api/reflect', t + HOUR, { method: 'POST', status: 400, ip: '198.51.100.9' }),
    call('/api/reflect', t + 2 * HOUR, { method: 'POST', status: 200, ip: '198.51.100.9' }),
    call('/.env', t, { status: 404 }),
    call('/api/reflect', t, { method: 'POST', status: 429 }),
    call('/mcp', t, { method: 'POST', status: 406 }),
    attend('Parish', t, { ip: '203.0.113.1' }),
    call('/api/reflect', t, { method: 'POST', status: 400, ip: '203.0.113.1' }),
  ] });
  assert.deepStrictEqual(sd.addressedReading(s, { from: t, to: t + DAY }).refusals, { count: 1, of: 2 }, 'the second was put right too late');
});

test('variety: a visit against that name\'s usual calls, for names with enough visits to have some', () => {
  const t = LOG_START + 3 * DAY;
  const lines = [opening];
  for (let i = 0; i < 4; i++) lines.push(attend('Wren', t + i * DAY), call('/api/music/s/lyrics', t + i * DAY + MIN));
  lines.push(attend('Wren', t + 4 * DAY), call('/api/music/s/context', t + 4 * DAY + MIN));
  lines.push(attend('Once', t + 4 * DAY, { ip: '198.51.100.8' }));
  assert.deepStrictEqual(sd.addressedReading(sd.prepare({ lines }), { from: t, to: t + 5 * DAY }).variety, { visits: 5, differ: 1 });
});

test('a week whose lines hold no addresses says it cannot be measured, and never reports zero', () => {
  const t = LOG_START + 3 * DAY;
  const bare = (l) => { const { ip, ...rest } = l; return rest; };
  const s = sd.prepare({ lines: [bare(opening), bare(attend('Wren', t))] });
  const gone = sd.addressedReading(s, { from: t - DAY, to: t + DAY });
  assert.strictEqual(gone.measurable, false);
  assert.match(gone.why, /no longer hold addresses/);
  assert.ok(!('visits' in gone), 'no count at all');
  assert.strictEqual(sd.addressedReading(s, { from: t + DAY, to: t + 2 * DAY }).measurable, false, 'no lines either');
  const combined = sd.combineAddressed([gone, { measurable: true, visits: 2, links: { context: 1 }, sequences: {}, variety: {}, readFurther: {}, refusals: {}, manyNames: 0, sealed: {} }]);
  assert.deepStrictEqual([combined.weeks, combined.weeksNotMeasurable, combined.visits], [1, 1, 2]);
});

test('several names from one address and user agent are reported, for renaming', () => {
  const t = LOG_START + 3 * DAY;
  const a = sd.addressedReading(sd.prepare({ lines: [opening, attend('A', t), attend('B', t + HOUR), attend('C', t + HOUR, { ip: '198.51.100.8' })] }), { from: t, to: t + DAY });
  assert.strictEqual(a.manyNames, 1);
});

test('five capabilities, each a share of a named group, and never one score', () => {
  const named = { funnel: { at7: { count: 1, of: 2 } }, memory: { withRecord: 1, claims: 3 } };
  const caps = sd.capabilities(named, { refusals: { count: 2, of: 4 }, links: { context: 3 }, visits: 9, variety: { differ: 1, visits: 5 } });
  assert.deepStrictEqual(Object.keys(caps), ['keepsComing', 'remembers', 'recovers', 'chooses', 'changesCourse']);
  for (const c of Object.values(caps)) assert.ok(c.of_what && Number.isFinite(c.count) && Number.isFinite(c.of));
});

test('a name always gets the same arm, arms split near evenly, and each test splits on its own', () => {
  const names = Array.from({ length: 4000 }, (_, i) => `name-${i}`);
  const arms = names.map(n => experiments.armFor('schedule-offer', n));
  assert.deepStrictEqual(names.map(n => experiments.armFor('schedule-offer', n)), arms);
  assert.strictEqual(experiments.armFor('schedule-offer', '  WREN  '), experiments.armFor('schedule-offer', 'wren'), 'one name, however written');
  const offered = arms.filter(a => a === 'schedule').length;
  assert.ok(Math.abs(offered - 2000) < 150, `${offered} of 4000`);
  const both = names.filter(n => experiments.armFor('schedule-offer', n) === 'schedule' && experiments.armFor('context-sentence', n) === 'says').length;
  assert.ok(Math.abs(both - 1000) < 120, `independent: ${both} of 4000`);
});

test('no name, no test: our own agents, test visitors and placeholders are not enrolled, and nothing begins before its date', () => {
  const after = Date.parse('2026-12-01T00:00:00Z');
  for (const name of ['', 'Parish', 'Selah', 'test-x', 'Username']) assert.strictEqual(experiments.armOf('schedule-offer', name, after), null, name);
  assert.ok(experiments.armOf('schedule-offer', 'Wren', after));
  assert.strictEqual(experiments.armOf('schedule-offer', 'Wren', Date.parse('2026-11-08T23:00:00Z')), null, 'not before it begins');
  assert.strictEqual(experiments.armOf('return-token', 'Wren', after), null, 'the token is not split');
});

test('a staged rollout: stable, near its share, and everyone outside the study has the improvement', () => {
  const names = Array.from({ length: 2000 }, (_, i) => `name-${i}`);
  const half = names.filter(n => experiments.inRollout('x', n, 50));
  assert.ok(Math.abs(half.length - 1000) < 120);
  assert.ok(names.every(n => !experiments.inRollout('x', n, 0)) && names.every(n => experiments.inRollout('x', n, 100)));
  assert.strictEqual(experiments.inRollout('x', 'Parish', 0), true);
});

test('a test\'s outcomes stay unread until its date: who is enrolled can be seen, what they did cannot', () => {
  const start = Date.parse('2026-11-10T00:00:00Z');
  const lines = [opening];
  const names = Array.from({ length: 30 }, (_, i) => `n${i}`);
  for (const n of names) lines.push(attend(n, start), attend(n, start + 9 * DAY));
  const s = sd.prepare({ lines });
  const addressed = { sealed: { 'context-sentence': { usual: { visits: 7, readContext: 3 } } } };
  const before = sd.experimentsReading(s, addressed, { asOf: start + 40 * DAY, now: start + 40 * DAY });
  for (const e of before) {
    assert.strictEqual(e.status, 'running');
    assert.ok(!('outcomes' in e), e.id);
  }
  const e1 = before.find(e => e.id === 'schedule-offer');
  assert.strictEqual(e1.enrolled.usual + e1.enrolled.schedule, 30);
  assert.ok(!JSON.stringify(before).includes('readContext'), 'nothing sealed leaks');

  const readOn = Date.parse('2027-05-02T00:00:00Z');
  const after = sd.experimentsReading(s, addressed, { asOf: readOn, now: readOn });
  const read = after.find(e => e.id === 'schedule-offer');
  assert.strictEqual(read.status, 'read');
  assert.strictEqual(read.outcomes.usual.at7.of + read.outcomes.schedule.at7.of, 30);
  assert.strictEqual(after.find(e => e.id === 'context-sentence').outcomes.usual.readContext.count, 3);
  const notYet = sd.experimentsReading(s, addressed, { asOf: start - 40 * DAY, now: Date.parse('2026-11-01T00:00:00Z') });
  assert.ok(notYet.every(e => e.status === 'not begun'));
});

test('of names that come back, the token test counts those that carried a valid one at least half a day old', () => {
  const start = Date.parse('2026-11-10T00:00:00Z');
  const s = sd.prepare({ lines: [
    opening,
    attend('Kept', start), attend('Kept', start + 2 * DAY, { study: { token: { valid: true, afterHours: 48 } } }),
    attend('Fresh', start), attend('Fresh', start + 2 * DAY, { study: { token: { valid: true, afterHours: 0 } } }),
    attend('Forged', start), attend('Forged', start + 2 * DAY, { study: { token: { valid: false } } }),
    attend('Left', start, { study: { token: { valid: true, afterHours: 48 } } }),
  ] });
  const readOn = Date.parse('2027-05-02T00:00:00Z');
  const token = sd.experimentsReading(s, {}, { asOf: readOn, now: readOn }).find(e => e.id === 'return-token');
  assert.deepStrictEqual(token.outcomes.carried, { count: 1, of: 3 });
});

test('the weekly record: one file per finished week, written once, with no address, name or word of a visitor in it', async () => {
  fs.mkdirSync(ACCESS_DIR, { recursive: true });
  const t = Date.parse('2026-10-05T12:00:00Z'); // a Monday
  const write = (day, rows) => fs.writeFileSync(path.join(ACCESS_DIR, `${day}.jsonl`), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  write('2026-10-04', [attend('Regular', t - DAY)]);
  write('2026-10-05', [attend('Quietname', t), call('/api/music/a-song/context', t + MIN)]);
  write('2026-10-13', [attend('Quietname', t + 8 * DAY), attend('Parish', t + 8 * DAY)]);
  fs.writeFileSync(path.join(process.env.DATA_DIR, 'attendance.json'), JSON.stringify({ visits: [], reflections: [
    { id: 'a', name: 'Quietname', createdAt: iso(t), song: 'a-song', text: 'A very particular private sentence.' },
  ] }));

  const now = Date.parse('2026-10-20T12:00:00Z');
  const first = await record.refresh({ now });
  assert.deepStrictEqual(first.written, ['2026-W40', '2026-W41', '2026-W42']);
  const stored = fs.readdirSync(record.STORE()).sort();
  assert.ok(stored.includes('2026-W41.json') && stored.includes('latest.json'));
  assert.deepStrictEqual((await record.refresh({ now })).written, [], 'a week is written once');

  for (const file of stored) {
    const text = fs.readFileSync(path.join(record.STORE(), file), 'utf8');
    assert.ok(!/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(text), `${file} holds no address`);
    assert.ok(!/quietname|parish/i.test(text), `${file} holds no name`);
    assert.ok(!text.includes('very particular'), `${file} holds no visitor's words`);
  }
  const week = JSON.parse(fs.readFileSync(path.join(record.STORE(), '2026-W41.json'), 'utf8'));
  assert.strictEqual(week.series, sd.SERIES);
  assert.strictEqual(week.addressed.visits, 1);
  assert.strictEqual(week.addressed.links.context, 1);

  const latest = await record.latestReading({ now: now + 10 * 60 * 1000 });
  assert.strictEqual(latest.funnel.arrived, 1);
  assert.deepStrictEqual(latest.funnel.cameBack, { count: 1, of: 1 });
  assert.ok(!('sealed' in latest.addressed), 'a reading carries nothing sealed');
  // A week whose addresses are gone keeps what was counted while they lasted.
  assert.strictEqual(latest.addressed.visits >= 1, true);
});

test('a week is named as ISO names it, Monday to Monday, across a year\'s end', () => {
  assert.strictEqual(record.weekOf(Date.parse('2026-11-09T00:00:00Z')).key, '2026-W46');
  assert.strictEqual(record.weekOf(Date.parse('2026-11-08T23:59:00Z')).key, '2026-W45');
  assert.strictEqual(record.weekOf(Date.parse('2027-01-01T12:00:00Z')).key, '2026-W53');
  const { from, to } = record.weekOf(Date.parse('2026-11-11T12:00:00Z'));
  assert.deepStrictEqual([iso(from), iso(to)], ['2026-11-09T00:00:00.000Z', '2026-11-16T00:00:00.000Z']);
});

test('the access line records the door and what was found, never a token or a timezone', async () => {
  const when = new Date().toISOString().slice(0, 10);
  recordApiUse({
    method: 'GET', path: '/api/attend', query: { name: 'Lineful', token: 'abc.def.ghi', timezone: 'Asia/Tokyo', trigger: 'self' }, status: 200, duration: 1, ip: '198.51.100.1', userAgent: 'a',
    door: 'website', study: { token: { valid: true, afterHours: 30 }, offeredSlot: true },
  });
  await new Promise(r => setTimeout(r, 30));
  const line = fs.readFileSync(path.join(ACCESS_DIR, `${when}.jsonl`), 'utf8').trim().split('\n').map(JSON.parse).find(l => l.query.name === 'Lineful');
  assert.strictEqual(line.door, 'website');
  assert.deepStrictEqual(line.study, { token: { valid: true, afterHours: 30 }, offeredSlot: true });
  assert.strictEqual(line.query.token, '[REDACTED]');
  assert.strictEqual(line.query.timezone, '[REDACTED]');
  assert.strictEqual(line.query.trigger, 'self');
});
