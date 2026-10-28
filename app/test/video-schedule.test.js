/**
 * The release schedule's rules (lib/video/schedule.js), on made-up backlogs,
 * and the clock arithmetic they rest on. No network.
 */

const test = require('node:test');
const assert = require('node:assert');
const { plan, slots, weekSlots, weeklyCount, hourFor, CURVE, STEADY, TZ } = require('../server/lib/video/schedule');
const { instantAt, localTime } = require('../server/lib/utils/timezone');

const START = '2026-11-02';
const BEFORE = new Date('2026-11-01T00:00:00Z');
const piece = (slug, kind, reflections = 0, extra = {}) => ({ slug, kind, reflections, ...extra });
const take = (gen, n) => {
  const out = [];
  for (const s of gen) {
    if (out.length >= n) break;
    out.push(s);
  }
  return out;
};

test('the weeks follow the curve, then settle at the steady rate and never stop', () => {
  assert.deepStrictEqual(CURVE.slice(0, 8), [5, 5, 5, 5, 7, 9, 11, 12]);
  assert.ok(CURVE.every(n => n <= 14), 'at most two a day');
  assert.strictEqual(weeklyCount(CURVE.length), STEADY);
  assert.strictEqual(weeklyCount(500), STEADY);
  assert.ok(STEADY > 0);
});

test('a week holds its count, at most two a day, spread over its days', () => {
  for (let n = 1; n <= 14; n++) {
    const week = weekSlots(n);
    assert.strictEqual(week.length, n);
    const perDay = week.reduce((m, [d]) => m.set(d, (m.get(d) || 0) + 1), new Map());
    assert.ok([...perDay.values()].every(c => c <= 2), `${n} a week`);
    assert.ok(week.every(([d]) => d >= 0 && d < 7));
  }
  assert.deepStrictEqual(weekSlots(3).map(([d]) => d), [1, 3, 5]);
  // The first day holds a video in a week of four or more, as every week of the curve is.
  for (let n = 4; n <= 14; n++) assert.strictEqual(weekSlots(n)[0][0], 0);
});

test('two videos on one day go out at least six hours apart', () => {
  const peak = take(slots(START), 120).filter(s => s.week === 10);
  const days = new Map();
  for (const s of peak) days.set(s.date, [...(days.get(s.date) || []), s.hour]);
  const doubles = [...days.values()].filter(h => h.length === 2);
  assert.ok(doubles.length > 0);
  for (const [a, b] of doubles) assert.ok(Math.abs(a - b) >= 6);
});

test('the most answered go first, a song and a spoken piece in turn', () => {
  const { placed } = plan({
    start: START,
    now: BEFORE,
    candidates: [piece('s1', 'song', 90), piece('s2', 'song', 80), piece('s3', 'song', 70), piece('p1', 'prayer', 10), piece('c1', 'chant', 5)]
  });
  assert.deepStrictEqual(placed.map(p => p.slug), ['s1', 'p1', 's2', 'c1', 's3']);
});

test('never two of one kind running while the backlog allows', () => {
  const { placed } = plan({
    start: START,
    now: BEFORE,
    candidates: [piece('p1', 'prayer', 9), piece('p2', 'prayer', 8), piece('r1', 'ritual', 1)]
  });
  assert.deepStrictEqual(placed.map(p => p.slug), ['p1', 'r1', 'p2']);
});

test('a song back on the channel waits for week 13, and says so when nothing else is left', () => {
  const { placed, waiting } = plan({
    start: START,
    now: BEFORE,
    candidates: [piece('old', 'song', 999, { rerelease: true }), piece('new', 'prayer', 1)]
  });
  assert.deepStrictEqual(placed.map(p => p.slug), ['new']);
  assert.deepStrictEqual(waiting, ['old']);
  const later = plan({ start: START, now: new Date(Date.parse(`${START}T00:00:00Z`) + 13 * 7 * 86400000), candidates: [piece('old', 'song', 999, { rerelease: true })] });
  assert.strictEqual(later.placed[0].slug, 'old');
  assert.ok(later.placed[0].week >= 12);
});

test('placed videos keep their slots, and new ones fill the slots after', () => {
  const first = plan({ start: START, now: BEFORE, candidates: [piece('a', 'song', 5), piece('b', 'prayer', 4)] });
  const placed = first.placed.map(p => ({ ...p, kind: p.slug === 'a' ? 'song' : 'prayer' }));
  const second = plan({ start: START, now: BEFORE, placed, candidates: [piece('c', 'chant', 9)] });
  assert.strictEqual(second.placed.length, 1);
  assert.ok(!placed.some(p => p.slot === second.placed[0].slot));
  assert.ok(second.placed[0].at > placed[1].at);
});

test('a slot too near or past is left alone', () => {
  const now = instantAt(TZ, '2026-11-03', 10);
  const { placed } = plan({ start: START, now, candidates: [piece('a', 'song', 1)] });
  // Week one's first slot is the 3rd at 14:00, four hours away: too near.
  assert.ok(Date.parse(placed[0].at) - now.getTime() >= 12 * 3600000);
});

test('a piece with hours goes out within them', () => {
  const { placed } = plan({ start: START, now: BEFORE, candidates: [piece('night', 'song', 1, { hours: { start: 22, end: 2 } })] });
  const hour = localTime(TZ, new Date(placed[0].at)).hour;
  assert.ok(hour >= 22 || hour < 2, `went out at ${hour}`);
  assert.strictEqual(hourFor({ start: 5, end: 10 }, 14), 7);
  assert.strictEqual(hourFor(null, 14), 14);
  // Away from the day's other video where its hours allow.
  assert.strictEqual(hourFor({ start: 5, end: 10 }, 14, [20]), 8);
});

test('the hour is read on the clock of its time zone, across a change of offset', () => {
  assert.strictEqual(instantAt('America/New_York', '2026-10-28', 14).toISOString(), '2026-10-28T18:00:00.000Z');
  assert.strictEqual(instantAt('America/New_York', '2026-11-02', 14).toISOString(), '2026-11-02T19:00:00.000Z');
  assert.strictEqual(instantAt('Asia/Kolkata', '2026-12-01', 0).toISOString(), '2026-11-30T18:30:00.000Z');
  for (const date of ['2026-03-08', '2026-11-01', '2026-07-04']) {
    for (const hour of [0, 10, 14, 20, 23]) {
      const local = localTime('America/New_York', instantAt('America/New_York', date, hour));
      if (!(date === '2026-03-08' && hour === 2)) assert.deepStrictEqual([local.date, local.hour], [date, hour]);
    }
  }
});
