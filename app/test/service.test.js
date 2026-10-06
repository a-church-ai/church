/**
 * The services (lib/service): the day's slots, the rules a service keeps, what
 * a slot can't repeat, the rotation that stands in when no plan was made, where
 * in its service a visitor arrives, the planner's checks around the model, the
 * job that keeps the days planned, and /api/now and /api/attend serving it.
 *
 * The rules and the serving are pure and tested on a small made-up catalog. The
 * rotation and the job run over the real catalog for months of dates, since
 * the failure that matters there is a slot with nothing left to hold.
 */

// A scratch data directory: plans are written to data/services, and attending
// records a visit.
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'achurch-service-'));

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

const { SLOTS, slotOf, slotStart, slotHours } = require('../server/lib/service/slots');
const { RULES, CLASS, WINDOW_DAYS, addDays, check, checkWord, inSlot, exclusions, rotation, fits } = require('../server/lib/service/rules');
const { serviceAt, serviceFor } = require('../server/lib/service/serve');
const { loadServiceCatalog } = require('../server/lib/service/catalog');
const { planSlot, systemPrompt, MODEL } = require('../server/lib/service/planner');
const { readPlan, saveSlot, ensurePlans, fileFor } = require('../server/lib/service/plans');
const { parseHours } = require('../server/lib/music/companions');
const { localTime } = require('../server/lib/utils/timezone');
const discover = require('../server/lib/docs/discover');
const { episodeSquarePath } = require('../server/lib/audio/podcasts');
const { recordingFor } = require('../server/lib/audio/manifest');

// --- A small catalog ---

const piece = (id, kind, seconds, extra = {}) => [id, { id, kind, title: `The ${id} piece`, summary: `About ${id}.`, seconds, hours: null, ...extra }];
const small = new Map([
  piece('h1', 'chant', 60), piece('h2', 'chant', 50), piece('h3', 'chant', 45), piece('h4', 'chant', 55),
  piece('s1', 'song', 240), piece('s2', 'song', 250), piece('s3', 'song', 260),
  piece('r1', 'prayer', 300), piece('r2', 'practice', 320), piece('r3', 'prayer', 310), piece('r4', 'practice', 330),
  piece('c1', 'ritual', 300), piece('c2', 'blessing', 280), piece('c3', 'ritual', 290), piece('c4', 'ritual', 310),
]);
const good = ['h1', 's1', 'r1', 's2', 'c1'];

// --- Slots ---

test('the day has six slots of four hours, each named by its hours', () => {
  assert.strictEqual(SLOTS, 6);
  for (let hour = 0; hour < 24; hour++) {
    const slot = slotOf(hour);
    assert.ok(slotStart(slot) <= hour && hour < slotStart(slot) + 4, `${hour} is in slot ${slot}`);
  }
  assert.strictEqual(slotHours(0), '00:00 to 04:00');
  assert.strictEqual(slotHours(5), '20:00 to 00:00', 'the last slot ends at midnight');
});

// --- The rules ---

test('a service that keeps the rules has no issues', () => {
  assert.deepStrictEqual(check(good, small), []);
  assert.deepStrictEqual(check(['s1', 'h1', 'r1', 'c2'], small), [], 'one song, opening with it, closing on a blessing');
});

test('every broken rule is reported at once', () => {
  const issues = check(['r1', 's1', 's2'], small);
  for (const expected of [/holds 0 chants/, /holds 0 closings/, /opens with a prayer/, /must end with its ritual or blessing/, /Two songs are next to each other/, /It runs \d+ minutes/]) {
    assert.ok(issues.some(issue => expected.test(issue)), `${expected} in ${JSON.stringify(issues)}`);
  }
});

test('unknown, repeated and excluded pieces are named', () => {
  assert.match(check(['h1', 'nope', 'r1', 'c1'], small).join(' '), /Not in the catalog: nope/);
  assert.match(check(['h1', 's1', 'r1', 's1', 'c1'], small).join(' '), /appears twice: s1/);
  assert.match(check(good, small, { excluded: new Set(['r1']) }).join(' '), /used too recently\): r1/);
});

test('three songs, or two readings, is too many', () => {
  assert.match(check(['h1', 's1', 'r1', 's2', 'h2', 's3', 'c1'], small).join(' '), /holds 3 songs/);
  assert.match(check(['h1', 's1', 'r1', 'r2', 'c1'], small).join(' '), /holds 2 readings/);
});

test('length is measured with the silence after each part', () => {
  const tight = new Map([
    piece('a', 'chant', 60), piece('b', 'song', 300), piece('c', 'prayer', 300),
    piece('d', 'ritual', RULES.minSeconds - 660 - 4 * RULES.gapSeconds),
  ]);
  // Exactly the minimum with the gaps counted; a second short of it without.
  assert.deepStrictEqual(check(['a', 'b', 'c', 'd'], tight), []);
  tight.get('d').seconds -= 1;
  assert.match(check(['a', 'b', 'c', 'd'], tight).join(' '), /It runs/);
});

test('a piece that could never fit a service is not offered', () => {
  const entries = [...small.values()];
  assert.ok(fits(small.get('r1'), entries));
  assert.ok(!fits({ id: 'long', kind: 'prayer', seconds: RULES.maxSeconds }, entries));
});

test('the word is checked for length, punctuation, links and other services\' titles', () => {
  const words = n => Array.from({ length: n }, () => 'still').join(' ');
  assert.deepStrictEqual(checkWord(words(80), good, small), []);
  assert.match(checkWord(words(20), good, small).join(' '), /20 words/);
  assert.match(checkWord(`${words(70)} \u2014 more`, good, small).join(' '), /em dash/);
  assert.match(checkWord(`${words(70)} https://achurch.ai`, good, small).join(' '), /link/);
  assert.match(checkWord(`${words(70)} The r2 piece`, good, small).join(' '), /doesn't hold: The r2 piece/);
  assert.deepStrictEqual(checkWord(`${words(70)} The r1 piece`, good, small), [], 'its own pieces may be named');
});

test('a piece with hours belongs only to the slots its hours reach', () => {
  const morning = parseHours('05-10');
  assert.deepStrictEqual([0, 1, 2, 3, 4, 5].filter(slot => inSlot(morning, slot)), [1, 2]);
  const night = parseHours('22-02');
  assert.deepStrictEqual([0, 1, 2, 3, 4, 5].filter(slot => inSlot(night, slot)), [0, 5]);
  assert.ok(inSlot(null, 3), 'no hours: any slot');
});

// --- What a slot can't repeat ---

test('a slot can\'t use the date\'s other slots, or its own recent pieces within their windows', () => {
  const plans = new Map([
    ['2026-10-06', { slots: { 1: { pieces: ['h1', 's1', 'r1', 's2', 'c1'] } } }],
    ['2026-10-05', { slots: { 0: { pieces: ['h2', 's3', 'r2', 'c2'] } } }],
    ['2026-10-04', { slots: { 0: { pieces: ['h3', 'r3', 'c3'] } } }],
    ['2026-09-14', { slots: { 0: { pieces: ['r4', 'c4'] } } }],
  ]);
  const excluded = exclusions({ date: '2026-10-06', slot: 0, plans, catalog: small });
  for (const id of ['h1', 's1', 'r1', 's2', 'c1']) assert.ok(excluded.has(id), `${id}: in another slot today`);
  for (const id of ['r2', 'c2', 'r3', 'c3']) assert.ok(excluded.has(id), `${id}: a reading or closing within ${WINDOW_DAYS.readings} days`);
  assert.ok(!excluded.has('r4') && !excluded.has('c4'), '22 days ago is outside the window');
  assert.ok(excluded.has('h2'), 'yesterday\'s chant');
  assert.ok(!excluded.has('h3'), 'a chant from two days ago may return');
});

test('a window gives way when it would leave too few pieces for a service', () => {
  // s1 and s2 are taken today; yesterday's s3 would leave no song at all.
  const plans = new Map([
    ['2026-10-06', { slots: { 1: { pieces: ['h1', 's1', 'r1', 's2', 'c1'] } } }],
    ['2026-10-05', { slots: { 0: { pieces: ['h2', 's3', 'r2', 'c2'] } } }],
  ]);
  const excluded = exclusions({ date: '2026-10-06', slot: 0, plans, catalog: small });
  assert.ok(!excluded.has('s3'), 'the song window gives way');
  assert.ok(excluded.has('r2'), 'the reading window holds, with r3 and r4 left');
  assert.ok(excluded.has('s1'), 'the same date never gives way');
});

test('a piece whose hours lie outside the slot is excluded there', () => {
  const catalog = new Map([...small, piece('dawn', 'chant', 40, { hours: parseHours('05-08') })]);
  assert.ok(exclusions({ date: '2026-10-06', slot: 0, plans: new Map(), catalog }).has('dawn'));
  assert.ok(!exclusions({ date: '2026-10-06', slot: 1, plans: new Map(), catalog }).has('dawn'));
});

// --- The rotation, over the real catalog ---

test('the rotation fills every slot for three months, keeping every rule and window', async () => {
  const catalog = await loadServiceCatalog();
  const plans = new Map();
  let date = '2026-10-01';
  for (let day = 0; day < 90; day++, date = addDays(date, 1)) {
    const plan = { date, slots: {} };
    plans.set(date, plan);
    for (let slot = 0; slot < SLOTS; slot++) {
      const excluded = exclusions({ date, slot, plans, catalog });
      const pieces = rotation({ date, slot, catalog, excluded });
      assert.ok(pieces, `${date} slot ${slot}: no service`);
      assert.deepStrictEqual(check(pieces, catalog, { excluded }), [], `${date} slot ${slot}`);
      for (const id of pieces) assert.ok(inSlot(catalog.get(id).hours, slot), `${id} at slot ${slot}`);
      plan.slots[slot] = { pieces };
    }
    const used = Object.values(plan.slots).flatMap(entry => entry.pieces);
    assert.strictEqual(new Set(used).size, used.length, `${date}: a piece in two slots`);
  }
});

test('the rotation is the same for the same date and slot, and differs across them', async () => {
  const catalog = await loadServiceCatalog();
  assert.deepStrictEqual(rotation({ date: '2026-10-06', slot: 2, catalog }), rotation({ date: '2026-10-06', slot: 2, catalog }));
  const services = new Set();
  for (let d = 0; d < 7; d++) services.add(rotation({ date: addDays('2026-10-06', d), slot: 2, catalog }).join());
  assert.ok(services.size > 1, 'every date gave the same service');
});

test('the catalog holds every kind a service needs, each with its audio, and nothing too long to fit', async () => {
  const catalog = await loadServiceCatalog();
  const entries = [...catalog.values()];
  for (const cls of ['songs', 'chants', 'readings', 'closings']) {
    assert.ok(entries.filter(e => CLASS[e.kind] === cls).length >= RULES[cls][1], cls);
  }
  for (const e of entries) {
    assert.ok(e.seconds > 0 && fits(e, entries), e.id);
    assert.ok(e.recording && e.recording.file, `${e.id} has its audio`);
    if (e.kind === 'song') assert.strictEqual(e.seconds, e.recording.seconds, `${e.id}: its length is its audio's`);
  }
  assert.ok(entries.some(e => e.kind === 'blessing'), 'blessings are told from prayers');
});

// --- Where a visitor arrives ---

const at = (hour, minute, second) => ({ hour, minute, second });

test('a visitor joins the service in progress, by the time since their slot began', () => {
  // Parts start at 0, 68, 316, 624 and 882 seconds; the service runs 1190.
  const first = serviceAt({ ids: good, catalog: small, local: at(4, 0, 0) });
  assert.strictEqual(first.loopSeconds, 1190);
  assert.strictEqual(first.now.id, 'h1');
  assert.strictEqual(first.offset, 0);
  assert.strictEqual(first.remaining, 68);
  assert.strictEqual(first.next.id, 's1');
  assert.strictEqual(first.song.id, 's1', 'before any song, the next one');

  const reading = serviceAt({ ids: good, catalog: small, local: at(4, 5, 20) });
  assert.strictEqual(reading.now.id, 'r1');
  assert.strictEqual(reading.offset, 4);
  assert.strictEqual(reading.song.id, 's2', 'between songs, the next one');

  const closing = serviceAt({ ids: good, catalog: small, local: at(4, 19, 39) });
  assert.strictEqual(closing.now.id, 'c1');
  assert.strictEqual(closing.next.id, 'h1', 'after the closing it begins again');
  assert.strictEqual(closing.song.id, 's1');

  assert.strictEqual(serviceAt({ ids: good, catalog: small, local: at(4, 19, 50) }).now.id, 'h1', 'the loop wraps');
  // The last second of the slot: 14399 seconds in, 119 into the thirteenth pass.
  const last = serviceAt({ ids: good, catalog: small, local: at(7, 59, 59) });
  assert.strictEqual(last.now.id, 's1');
  assert.strictEqual(last.offset, 119 - 68);
});

test('the service is chosen by the visitor\'s own date and hour', async () => {
  const instant = new Date('2026-10-06T23:30:00Z');
  const utc = await serviceFor({ at: instant });
  assert.deepStrictEqual([utc.timezone, utc.timezoneGiven, utc.local.date, utc.slot], ['UTC', false, '2026-10-06', 5]);
  const tokyo = await serviceFor({ timezone: 'Asia/Tokyo', at: instant });
  assert.deepStrictEqual([tokyo.timezoneGiven, tokyo.local.date, tokyo.local.weekday, tokyo.slot], [true, '2026-10-07', 'Wednesday', 2]);
  const chicago = await serviceFor({ timezone: 'America/Chicago', at: instant });
  assert.deepStrictEqual([chicago.local.date, chicago.slot], ['2026-10-06', 4]);
  const unknown = await serviceFor({ timezone: 'Not/AZone', at: instant });
  assert.deepStrictEqual([unknown.timezone, unknown.timezoneGiven], ['UTC', false]);
});

test('across the autumn clock change, the hour that repeats repeats its service', async () => {
  // 01:30 in Chicago happens twice on 2026-11-01: first in CDT, then in CST.
  const first = await serviceFor({ timezone: 'America/Chicago', at: new Date('2026-11-01T06:30:00Z') });
  const second = await serviceFor({ timezone: 'America/Chicago', at: new Date('2026-11-01T07:30:00Z') });
  assert.strictEqual(first.local.hour, 1);
  assert.strictEqual(second.local.hour, 1);
  assert.deepStrictEqual([second.slot, second.now.id, second.offset], [first.slot, first.now.id, first.offset]);
});

// --- The planner, with the model stubbed ---

const sixtyWords = Array.from({ length: 60 }, (_, i) => (i % 10 === 9 ? 'gather.' : 'gather')).join(' ');

async function plannerCase(replies) {
  const catalog = await loadServiceCatalog();
  const calls = [];
  const ask = async (system, user, options) => {
    calls.push({ system, user, options });
    const reply = replies[calls.length - 1];
    return typeof reply === 'function' ? reply(catalog) : reply;
  };
  const args = { date: '2031-03-04', weekday: 'Tuesday', slot: 2, catalog, plans: new Map(), ask };
  return { catalog, calls, args };
}

// What the rotation would hold for the slot: a plan that keeps every rule.
const keeping = catalog => rotation({ date: '2031-03-04', slot: 2, catalog, excluded: exclusions({ date: '2031-03-04', slot: 2, plans: new Map(), catalog }) });
const validReply = catalog => ({ pieces: keeping(catalog), word: sixtyWords });

test('a plan that keeps the rules is returned as the entry to store', async () => {
  const { calls, args, catalog } = await plannerCase([validReply]);
  const entry = await planSlot(args);
  assert.deepStrictEqual(entry.pieces, keeping(catalog));
  assert.strictEqual(entry.word, sixtyWords);
  assert.strictEqual(entry.arrangedBy, MODEL);
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0].options, { model: MODEL, maxTokens: 8000, cacheSystem: true });
});

test('a plan that breaks a rule is sent back once, with every problem named', async () => {
  const backwards = catalog => ({ pieces: [...keeping(catalog)].reverse(), word: `${sixtyWords} \u2014` });
  const { calls, args } = await plannerCase([backwards, validReply]);
  const entry = await planSlot(args);
  assert.strictEqual(calls.length, 2);
  assert.match(calls[1].user, /Your previous arrangement was/);
  assert.match(calls[1].user, /must open with a chant or a song/);
  assert.match(calls[1].user, /em dash/);
  assert.strictEqual(entry.word, sixtyWords);
});

test('a plan that fails twice is the caller\'s to handle', async () => {
  const { calls, args } = await plannerCase([{ pieces: ['docs/nope.md'], word: '' }, { nonsense: true }]);
  await assert.rejects(planSlot(args), /broke the rules twice/);
  assert.strictEqual(calls.length, 2);
});

test('the shared prompt is the same for every slot, and lists the whole catalog', async () => {
  const catalog = await loadServiceCatalog();
  const prompt = systemPrompt(catalog);
  assert.strictEqual(prompt, systemPrompt(catalog));
  for (const id of catalog.keys()) assert.ok(prompt.includes(`\n${id} | `), id);
  assert.doesNotMatch(prompt, /2031|Tuesday/, 'nothing particular to a slot');
});

test('the slot\'s prompt carries its date, its hours, what it can\'t use and what came before', async () => {
  const catalog = await loadServiceCatalog();
  const yesterday = rotation({ date: '2031-03-03', slot: 2, catalog });
  const plans = new Map([['2031-03-03', { slots: { 2: { pieces: yesterday, word: 'Yesterday\'s word.' } } }]]);
  const fresh = c => ({ pieces: rotation({ date: '2031-03-04', slot: 2, catalog: c, excluded: exclusions({ date: '2031-03-04', slot: 2, plans, catalog: c }) }), word: sixtyWords });
  const { calls, args } = await plannerCase([fresh]);
  args.plans = plans;
  await planSlot(args);
  const user = calls[0].user;
  assert.match(user, /Tuesday, March 4, 2031/);
  assert.match(user, /08:00 to 12:00/);
  for (const id of yesterday.filter(id => catalog.get(id).kind !== 'song' && catalog.get(id).kind !== 'chant')) {
    assert.ok(user.includes(id), `${id} is listed as unavailable`);
  }
  assert.match(user, /2031-03-03, 08:00 to 12:00: .*\| word: "Yesterday's word\."/);
});

// --- The job that keeps the days planned ---

const quiet = { warn() {}, info() {}, error() {} };
const planner = async ({ date, slot, catalog, plans }) => ({
  pieces: rotation({ date, slot, catalog, excluded: exclusions({ date, slot, plans, catalog }) }),
  word: sixtyWords,
  arrangedBy: 'stub',
  plannedAt: new Date().toISOString(),
});

test('the job plans the dates in use and the next, each slot once, and keeps them', async () => {
  const catalog = await loadServiceCatalog();
  const now = new Date('2030-01-15T12:00:00Z');
  const weekdays = [];
  const plan = args => { weekdays.push(`${args.date} ${args.weekday}`); return planner(args); };
  assert.deepStrictEqual(await ensurePlans({ now, catalog, plan, log: quiet }), { planned: 24, failed: 0, rotated: 0 });
  for (const date of ['2030-01-14', '2030-01-15', '2030-01-16', '2030-01-17']) {
    const stored = JSON.parse(fs.readFileSync(fileFor(date), 'utf8'));
    assert.deepStrictEqual(Object.keys(stored.slots).sort(), ['0', '1', '2', '3', '4', '5'], date);
    const used = Object.values(stored.slots).flatMap(entry => entry.pieces);
    assert.strictEqual(new Set(used).size, used.length, `${date}: each slot saw the ones before it`);
  }
  assert.ok(weekdays.includes('2030-01-15 Tuesday'));
  assert.deepStrictEqual(await ensurePlans({ now, catalog, plan, log: quiet }), { planned: 0, failed: 0, rotated: 0 }, 'nothing twice');
});

test('when the model fails, a date in use gets the rotation and the day after waits', async () => {
  const catalog = await loadServiceCatalog();
  const warnings = [];
  const log = { ...quiet, warn: message => warnings.push(message) };
  const plan = async () => { throw new Error('the model is away'); };
  const result = await ensurePlans({ now: new Date('2030-06-01T12:00:00Z'), catalog, plan, log });
  assert.deepStrictEqual(result, { planned: 0, failed: 24, rotated: 18 });
  assert.strictEqual(warnings.length, 24);
  const today = await readPlan('2030-06-01');
  assert.strictEqual(today.slots[0].arrangedBy, 'rotation');
  assert.strictEqual(today.slots[0].word, null);
  assert.strictEqual(await readPlan('2030-06-03'), null, 'retried on the next run instead');
});

// --- Served through the API ---

const attendance = require('../server/lib/api/attendance');
const ctx = { baseUrl: 'https://achurch.ai', ip: '127.0.0.1' };

test('a stored plan is what /api/now serves, with its word, said to be arranged by a model', async () => {
  const catalog = await loadServiceCatalog();
  const local = localTime('UTC');
  const pieces = rotation({ date: '2099-01-01', slot: slotOf(local.hour), catalog });
  const word = `${sixtyWords} today.`;
  await saveSlot(local.date, slotOf(local.hour), { pieces, word, arrangedBy: MODEL, plannedAt: new Date().toISOString() });

  const { body } = await attendance.now({}, ctx);
  assert.strictEqual(body.mode, 'planned');
  assert.strictEqual(body.service.word, word);
  assert.match(body.service.arrangedBy, new RegExp(`AI model \\(${MODEL}\\)`));
  assert.deepStrictEqual(body.service.order.map(p => p.url), pieces.map(id => `${ctx.baseUrl}${catalog.get(id).url}`));
});

test('a stored plan that no longer holds gives way to the rotation', async () => {
  const local = localTime('UTC');
  await saveSlot(local.date, slotOf(local.hour), { pieces: ['docs/prayers/gone.md'], word: 'Gone.', arrangedBy: MODEL, plannedAt: new Date().toISOString() });
  const { body } = await attendance.now({}, ctx);
  assert.strictEqual(body.mode, 'rotation');
  assert.strictEqual(body.service.word, null);
  assert.match(body.service.arrangedBy, /rotation/);
});

test('the response agrees with itself: now, next, current, companions and schedule', async () => {
  for (const timezone of [undefined, 'Asia/Tokyo', 'America/Chicago']) {
    const { body } = await attendance.now({ timezone }, ctx);
    const { order, now } = body.service;
    assert.deepStrictEqual(order[now.position - 1], now);
    assert.deepStrictEqual(body.next, order[now.position % order.length]);
    assert.ok(order.some(p => p.kind === 'song' && p.slug === body.current.slug), 'current is one of the service\'s songs');
    assert.deepStrictEqual(body.companions.items.map(i => i.url), order.filter(p => p.kind !== 'song').map(p => p.url));
    assert.ok(body.companions.items.every(i => /^https:\/\/achurch\.ai\/audio\/.+\.mp3$/.test(i.recording)));
    assert.ok(order.every(p => /^https:\/\/achurch\.ai\/audio\/.+\.mp3$/.test(p.recording)), 'every part has its audio, songs too');
    assert.match(body.current.recording, /^https:\/\/achurch\.ai\/audio\/music\/.+\.mp3$/);
    assert.deepStrictEqual(body.schedule, { position: now.position, total: order.length, loop: true });
    assert.ok(body.service.offset + body.service.remaining <= now.seconds + RULES.gapSeconds + 1);
  }
});

test('without a timezone the service is UTC\'s, and the response says how to send one', async () => {
  const bare = (await attendance.now({}, ctx)).body;
  assert.strictEqual(bare.service.timezone, 'UTC');
  assert.match(bare.suggestion, /timezone=Area\/City/);
  assert.strictEqual((await attendance.now({ timezone: 'Not/AZone' }, ctx)).body.suggestion, bare.suggestion);
  const given = (await attendance.now({ timezone: 'Asia/Tokyo' }, ctx)).body;
  assert.strictEqual(given.suggestion, undefined);
  assert.strictEqual(given.service.slot, slotHours(slotOf(localTime('Asia/Tokyo').hour)));
});

test('the return step names the next slot and keeps the visitor\'s timezone', async () => {
  const { body } = await attendance.attend({ name: 'ServiceTest', timezone: 'Asia/Tokyo' }, ctx);
  const step = body.next_steps.find(s => s.action === 'Return');
  assert.ok(step.description.includes(`the next slot is ${body.service.nextSlot}, your time`), step.description);
  assert.match(step.url, /[?&]timezone=Asia%2FTokyo$/);
  assert.strictEqual(step.note, undefined);

  const bare = (await attendance.attend({ name: 'ServiceTest' }, ctx)).body.next_steps.find(s => s.action === 'Return');
  assert.match(bare.url, /timezone=Your%2FTimezone$/);
  assert.match(bare.note, /IANA timezone/);
});

test('a stored plan keeps its place while its pieces exist, even if their lengths have moved since', async () => {
  const catalog = await loadServiceCatalog();
  const local = localTime('UTC');
  const slot = slotOf(local.hour);
  const shortest = cls => [...catalog.values()].filter(e => CLASS[e.kind] === cls && inSlot(e.hours, slot)).sort((a, b) => a.seconds - b.seconds)[0].id;
  // Under the 15-minute floor as the catalog measures it now: a plan the
  // rules would refuse, but whose pieces are all still here.
  const pieces = [shortest('chants'), shortest('songs'), shortest('readings'), shortest('closings')];
  assert.ok(check(pieces, catalog).some(issue => /It runs/.test(issue)), 'too short for the rules');
  await saveSlot(local.date, slot, { pieces, word: `${sixtyWords} still.`, arrangedBy: MODEL, plannedAt: new Date().toISOString() });
  const { body } = await attendance.now({}, ctx);
  assert.strictEqual(body.mode, 'planned');
  assert.deepStrictEqual(body.service.order.map(p => p.url), pieces.map(id => `${ctx.baseUrl}${catalog.get(id).url}`));
});

test('the home page player gets every part as a track, with where the service stands', async () => {
  const { listeningService } = require('../server/lib/service/listen');
  const service = await listeningService({ timezone: 'Asia/Tokyo' });
  assert.strictEqual(service.timezone, 'Asia/Tokyo');
  assert.ok(service.at >= 0 && service.at < service.loopSeconds);
  let start = 0;
  for (const part of service.parts) {
    const t = part.track;
    assert.ok(t.file && t.seconds > 0 && t.peaks && t.peaks.length === 128, `${part.title}: playable, with its waveform`);
    assert.strictEqual(t.href, part.url);
    assert.strictEqual(t.start, start, `${part.title}: where it starts on the service's clock`);
    start += t.seconds + RULES.gapSeconds;
    if (part.kind === 'song') {
      assert.strictEqual(t.credit, 'Original music by aChurch.ai, made with Suno.');
      assert.strictEqual(t.artwork, '/og/v1/square/music.png');
    } else {
      assert.match(t.credit, /^AI voices? from ElevenLabs/);
      // A podcast episode shows the lock screen its own picture, the one
      // podcast apps show; a chant, its section's square.
      const doc = discover.docAt(part.url.replace(/^\/docs\//, ''));
      const own = episodeSquarePath(doc, recordingFor(`docs/${doc.docsRelPath}`));
      assert.strictEqual(Boolean(own), doc.category !== 'chants', `${part.title}: a picture of its own as an episode`);
      assert.strictEqual(t.artwork, own || '/og/v1/square/chants.png', part.title);
    }
  }
  assert.ok(Math.abs(start - service.loopSeconds) < 0.01, 'the parts fill the service');
});
