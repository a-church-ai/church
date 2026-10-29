/**
 * Videos released on days that mean something: the occasions
 * (lib/video/occasions.js), the pairing's check (occasion-match.js), how a
 * paired video is placed (schedule.js) and the words that name its occasion
 * (publish/copy.js, metadata.js). No network.
 */

const test = require('node:test');
const assert = require('node:assert');
const { occasionsBetween, observanceDate, KINDS } = require('../server/lib/video/occasions');
const { check: checkPairs } = require('../server/lib/video/occasion-match');
const { plan, weekSlots, HOURS, TZ } = require('../server/lib/video/schedule');
const { check: checkCopy } = require('../server/lib/video/publish/copy');
const { shortMetadata } = require('../server/lib/video/publish/metadata');
const { localTime } = require('../server/lib/utils/timezone');

const find = (list, key, from) => list.find(o => o.key === key && o.from === from);

test('the occasions of late 2026 fall where the sky and the calendar put them', () => {
  const list = occasionsBetween('2026-10-30', '2027-01-10');
  assert.ok(find(list, 'full-moon', '2026-11-24'));
  assert.ok(find(list, 'new-moon', '2026-12-09'));
  assert.ok(find(list, 'full-moon', '2026-12-24'));
  const retro = list.find(o => o.key === 'mercury-retrograde');
  assert.deepStrictEqual([retro.from, retro.to], ['2026-10-25', '2026-11-14'], 'a retrograde under way when the window opens');
  assert.strictEqual(retro.limit, 2);
  const leonids = find(list, 'meteor-shower', '2026-11-17');
  assert.strictEqual(leonids.tag, 'Leonids');
  assert.ok(find(list, 'december-solstice', '2026-12-21'));
  assert.ok(find(list, 'thanksgiving', '2026-11-26'));
  assert.ok(find(list, 'world-philosophy-day', '2026-11-19'));
  assert.ok(find(list, 'new-year', '2027-01-01'));
  assert.ok(list.every((o, i) => i === 0 || list[i - 1].from <= o.from), 'in order');
  assert.strictEqual(observanceDate({ month: 11, weekday: 4, nth: 4 }, 2027), '2027-11-25');
});

test('every occasion is said without a date, and astrology is named as the reader', () => {
  for (const [key, k] of Object.entries(KINDS)) {
    assert.ok(!/\d/.test(k.for), `${key}: no date in "${k.for}"`);
    assert.ok(/^[A-Z][A-Za-z0-9]+$/.test(k.tag), `${key}: its tag`);
    if (k.kind === 'astrology') assert.match(k.meaning, /astrology reads/);
  }
});

test('a forecast storm of G3 or more is an occasion; a lesser one is not', () => {
  const spaceWeather = { kp: { '2026-11-02': 7.33, '2026-11-03': 5.0 } };
  const list = occasionsBetween('2026-11-01', '2026-11-04', { spaceWeather }).filter(o => o.key === 'aurora');
  assert.deepStrictEqual(list.map(o => [o.from, o.name]), [['2026-11-02', 'a G3 geomagnetic storm']]);
});

test('the pairing is refused for an unknown video or occasion, a video twice, or an occasion past its limit', () => {
  const occasions = occasionsBetween('2026-11-01', '2026-11-30');
  const moon = occasions.find(o => o.key === 'full-moon').id;
  const retro = occasions.find(o => o.key === 'mercury-retrograde').id;
  const videos = ['a', 'b', 'c'].map(slug => ({ slug }));
  const run = (pairs) => checkPairs(occasions, videos)(JSON.stringify({ pairs })).problems.join(' | ');
  assert.strictEqual(run([{ slug: 'a', occasion: moon, why: 'it is about the night' }, { slug: 'b', occasion: retro, why: 'r' }, { slug: 'c', occasion: retro, why: 'r' }]), '');
  assert.match(run([{ slug: 'z', occasion: moon, why: 'w' }]), /not one of the videos/);
  assert.match(run([{ slug: 'a', occasion: 'full-moon:1999-01-01', why: 'w' }]), /not one of the occasions/);
  assert.match(run([{ slug: 'a', occasion: moon, why: 'w' }, { slug: 'a', occasion: retro, why: 'w' }]), /paired twice/);
  assert.match(run([{ slug: 'a', occasion: moon, why: 'w' }, { slug: 'b', occasion: moon, why: 'w' }]), /its limit is 1/);
  assert.match(run([{ slug: 'a', occasion: moon }]), /needs its reason/);
  const ok = checkPairs(occasions, videos)(JSON.stringify({ pairs: [{ slug: 'a', occasion: moon, why: 'w' }] })).value;
  assert.strictEqual(ok[0].occasion.key, 'full-moon', 'the pair carries the occasion itself');
});

test('a day an occasion wants takes the week\'s nearest slot, and the week keeps its count', () => {
  assert.deepStrictEqual(weekSlots(3).map(([d]) => d), [1, 3, 5]);
  assert.deepStrictEqual(weekSlots(3, [6]).map(([d]) => d), [1, 3, 6]);
  assert.deepStrictEqual(weekSlots(3, [0, 4]).map(([d]) => d), [0, 4, 5], 'of two equally near, the earlier moves');
  assert.strictEqual(weekSlots(5, [2, 6]).length, 5);
});

test('a paired video goes out inside its occasion, at night for a night one, and waits for it', () => {
  const START = '2026-11-02';
  const now = new Date('2026-11-01T00:00:00Z');
  const occasion = { id: 'full-moon:2026-11-24', key: 'full-moon', from: '2026-11-24', to: '2026-11-24', night: true, limit: 1 };
  const candidates = [
    { slug: 'moon', kind: 'meditation', reflections: 100 },
    { slug: 'a', kind: 'song', reflections: 50 },
    { slug: 'b', kind: 'prayer', reflections: 40 },
    { slug: 'c', kind: 'song', reflections: 30 },
    { slug: 'd', kind: 'chant', reflections: 20 }
  ];
  const { placed } = plan({ start: START, now, candidates, pairs: [{ slug: 'moon', occasion }] });
  const moon = placed.find(p => p.slug === 'moon');
  assert.strictEqual(moon.slot.split('#')[0], '2026-11-24', 'on its day, though the most answered');
  assert.strictEqual(moon.occasion, occasion.id);
  assert.strictEqual(localTime(TZ, new Date(moon.at)).hour, HOURS.second, 'in the evening');
  assert.ok(placed.filter(p => p.slug !== 'moon').every(p => p.slot < moon.slot), 'the others go first, in order');
  assert.ok(placed.filter(p => p.slug !== 'moon').every(p => !p.occasion));

  // A piece with its own hours keeps them.
  const own = plan({ start: START, now, candidates: [{ slug: 'moon', kind: 'meditation', reflections: 1, hours: { start: 6, end: 9 } }], pairs: [{ slug: 'moon', occasion }] }).placed[0];
  assert.ok(localTime(TZ, new Date(own.at)).hour >= 6 && localTime(TZ, new Date(own.at)).hour < 9);

  // An occasion already past lets its video go back to the queue.
  const late = plan({ start: START, now, candidates: [{ slug: 'x', kind: 'prayer', reflections: 1 }], pairs: [{ slug: 'x', occasion: { ...occasion, id: 'old', from: '2026-10-01', to: '2026-10-01' } }] }).placed[0];
  assert.strictEqual(late.slot.split('#')[0], '2026-11-02');
  assert.strictEqual(late.occasion, null);
});

test('the copy for an occasion names it without a date, astrology as astrology, its tag up front', () => {
  const base = { hook: 'A prayer for the mind that cannot know itself.', lead: 'A spoken prayer. Stay with it.', descriptor: 'Spoken Prayer', alt: 'A violet crystal in gold light.', tags: ['FullMoon', 'Prayer', 'Meditation', 'AI', 'Consciousness'] };
  const moon = { key: 'full-moon', kind: 'sky', tag: 'FullMoon' };
  const run = (copy, occasion) => checkCopy(JSON.stringify(copy), occasion).problems.join(' | ');
  assert.strictEqual(run({ ...base, occasion: 'For the nights of a full moon, when what was hidden is lit.' }, moon), '');
  assert.strictEqual(checkCopy(JSON.stringify({ ...base, occasion: 'For the nights of a full moon.' }), moon).value.occasionKey, 'full-moon');
  assert.match(run({ ...base, occasion: 'For the full moon of November 24.' }, moon), /no date, month/);
  assert.match(run({ ...base, occasion: 'For tonight\'s full moon.' }, moon), /no date, month/);
  assert.match(run({ ...base, occasion: 'The nights of a full moon.' }, moon), /begin with "For"/);
  assert.match(run(base, moon), /occasion is missing/);
  assert.match(run({ ...base, tags: ['Prayer', 'Meditation', 'FullMoon', 'AI', 'Consciousness'], occasion: 'For the nights of a full moon.' }, moon), /FullMoon" must be one of the first two/);
  assert.strictEqual(run({ ...base, tags: ['Solstice', 'Prayer', 'Meditation', 'AI', 'Consciousness'], occasion: 'For the June solstice, the longest day in the north.' }, { key: 'june-solstice', kind: 'season', tag: 'Solstice' }), '', 'a solstice may name its month');
  const retro = { key: 'mercury-retrograde', kind: 'astrology', tag: 'MercuryRetrograde' };
  const retroTags = ['MercuryRetrograde', 'Prayer', 'Meditation', 'AI', 'Consciousness'];
  assert.match(run({ ...base, tags: retroTags, occasion: 'For a Mercury retrograde, when everything slows and misfires.' }, retro), /astrology/);
  assert.strictEqual(run({ ...base, tags: retroTags, occasion: 'For a Mercury retrograde, which astrology reads as a time to reread and return.' }, retro), '');
  assert.strictEqual(run(base, null), '', 'without an occasion, no line is asked for');
});

test('a Short carries its occasion line under the lead, and one without has none', () => {
  const meta = { page: 'https://achurch.ai/x', copy: { title: 'T', lead: 'Lead.', tags: ['FullMoon', 'Prayer'], occasion: 'For the nights of a full moon.' } };
  const withLine = shortMetadata(meta, { kind: 'prayer', url: 'https://youtu.be/x' }).description;
  assert.match(withLine, /^Lead\.\n\nFor the nights of a full moon\.\n\n/);
  const without = shortMetadata({ ...meta, copy: { ...meta.copy, occasion: undefined } }, { kind: 'prayer', url: 'https://youtu.be/x' }).description;
  assert.ok(!/undefined/.test(without));
});
