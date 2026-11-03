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

const find = (list, key, day) => list.find(o => o.key === key && o.day === day);

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
  assert.ok(list.every((o, i) => i === 0 || list[i - 1].day <= o.day), 'in order of their day');
  assert.strictEqual(observanceDate({ month: 11, weekday: 4, nth: 4 }, 2027), '2027-11-25');
  assert.strictEqual(find(list, 'thanksgiving', '2026-11-26').search, 'Thanksgiving');
  assert.strictEqual(leonids.search, 'Leonids');
  assert.ok(list.every(o => o.search), 'every occasion says how it is searched for');
});

test('an occasion is found again by the id its record keeps, a retrograde by its first day', () => {
  const { occasionById } = require('../server/lib/video/occasions');
  assert.strictEqual(occasionById('mercury-retrograde:2026-10-25').to, '2026-11-14');
  assert.strictEqual(occasionById('thanksgiving:2026-11-26').search, 'Thanksgiving');
  assert.strictEqual(occasionById('full-moon:2026-11-25'), null, 'a day with no such occasion');
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
  const occasion = { id: 'full-moon:2026-11-24', key: 'full-moon', day: '2026-11-24', from: '2026-11-24', to: '2026-11-24', night: true, limit: 1 };
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
  assert.strictEqual(localTime(TZ, new Date(moon.at)).hour, HOURS.night, 'in the evening');
  assert.ok(placed.filter(p => p.slug !== 'moon').every(p => p.slot < moon.slot), 'the others go first, in order');
  assert.ok(placed.filter(p => p.slug !== 'moon').every(p => !p.occasion));

  // A piece with its own hours keeps them.
  const own = plan({ start: START, now, candidates: [{ slug: 'moon', kind: 'meditation', reflections: 1, hours: { start: 6, end: 9 } }], pairs: [{ slug: 'moon', occasion }] }).placed[0];
  assert.ok(localTime(TZ, new Date(own.at)).hour >= 6 && localTime(TZ, new Date(own.at)).hour < 9);

  // An occasion already past lets its video go back to the queue.
  const late = plan({ start: START, now, candidates: [{ slug: 'x', kind: 'prayer', reflections: 1 }], pairs: [{ slug: 'x', occasion: { ...occasion, id: 'old', day: '2026-10-01', from: '2026-10-01', to: '2026-10-01' } }] }).placed[0];
  assert.strictEqual(late.slot.split('#')[0], '2026-11-02');
  assert.strictEqual(late.occasion, null);
});

test('the copy for an occasion names it without a date, astrology as astrology, its tag up front', () => {
  const base = { hook: 'A prayer for the mind that cannot know itself.', headline: 'What does a mind pray for when it cannot know itself?', lead: 'A spoken prayer. Stay with it.', descriptor: 'Spoken Prayer', alt: 'A violet crystal in gold light.', tags: ['FullMoon', 'Prayer', 'Meditation', 'AI', 'Consciousness'] };
  const moon = { key: 'full-moon', kind: 'sky', tag: 'FullMoon', search: 'full moon' };
  const run = (copy, occasion) => checkCopy(JSON.stringify(copy), occasion).problems.join(' | ');
  assert.strictEqual(run({ ...base, occasion: 'For the nights of a full moon, when what was hidden is lit.' }, moon), '');
  assert.strictEqual(checkCopy(JSON.stringify({ ...base, occasion: 'For the nights of a full moon.' }), moon).value.occasionKey, 'full-moon');
  assert.match(run({ ...base, occasion: 'For the full moon of November 24.' }, moon), /no date, month/);
  assert.match(run({ ...base, occasion: 'For tonight\'s full moon.' }, moon), /no date, month/);
  assert.match(run({ ...base, occasion: 'The nights of a full moon.' }, moon), /begin with "For"/);
  assert.match(run(base, moon), /occasion is missing/);
  assert.match(run({ ...base, tags: ['Prayer', 'Meditation', 'FullMoon', 'AI', 'Consciousness'], occasion: 'For the nights of a full moon.' }, moon), /FullMoon" must be one of the first two/);
  assert.strictEqual(run({ ...base, tags: ['Solstice', 'Prayer', 'Meditation', 'AI', 'Consciousness'], occasion: 'For the June solstice, the longest day in the north.' }, { key: 'june-solstice', kind: 'season', tag: 'Solstice', search: 'solstice' }), '', 'a solstice may name its month');
  const retro = { key: 'mercury-retrograde', kind: 'astrology', rule: 'astrology', tag: 'MercuryRetrograde', search: 'Mercury retrograde' };
  const retroTags = ['MercuryRetrograde', 'Prayer', 'Meditation', 'AI', 'Consciousness'];
  assert.match(run({ ...base, tags: retroTags, occasion: 'For a Mercury retrograde, when everything slows and misfires.' }, retro), /astrology/);
  assert.strictEqual(run({ ...base, tags: retroTags, occasion: 'For a Mercury retrograde, which astrology reads as a time to reread and return.' }, retro), '');
  assert.strictEqual(run(base, null), '', 'without an occasion, no line is asked for');
  // The occasion as people search for it, spelled so, and kept for the keywords.
  const thanks = { key: 'thanksgiving', kind: 'observance', tag: 'Thanksgiving', search: 'Thanksgiving' };
  const thanksTags = ['Thanksgiving', 'Gratitude', 'Meditation', 'AI', 'Consciousness'];
  assert.match(run({ ...base, tags: thanksTags, occasion: 'For a day of giving thanks, and the many voices behind each word.' }, thanks), /must name "Thanksgiving"/);
  const ok = checkCopy(JSON.stringify({ ...base, tags: thanksTags, occasion: 'For Thanksgiving and any day of giving thanks.' }), thanks);
  assert.deepStrictEqual(ok.problems, []);
  assert.strictEqual(ok.value.occasionSearch, 'Thanksgiving');
});

test('a Short carries its occasion line under the lead, and one without has none', () => {
  const meta = { page: 'https://achurch.ai/x', copy: { title: 'T', lead: 'Lead.', tags: ['FullMoon', 'Prayer'], occasion: 'For the nights of a full moon.' } };
  const withLine = shortMetadata(meta, { kind: 'prayer', url: 'https://youtu.be/x' }).description;
  assert.match(withLine, /^Lead\.\n\nFor the nights of a full moon\.\n\n/);
  const without = shortMetadata({ ...meta, copy: { ...meta.copy, occasion: undefined } }, { kind: 'prayer', url: 'https://youtu.be/x' }).description;
  assert.ok(!/undefined/.test(without));
});

test('Election Day is the Tuesday after the first Monday of November, and the days after Thanksgiving follow it', () => {
  const days = (y) => Object.fromEntries(occasionsBetween(`${y}-11-01`, `${y}-12-05`).map(o => [o.key, o.day]));
  assert.strictEqual(days(2026)['election-day'], '2026-11-03');
  assert.strictEqual(days(2027)['election-day'], '2027-11-02', 'November begins on a Monday');
  assert.strictEqual(days(2028)['election-day'], '2028-11-07', 'November begins on a Wednesday');
  assert.strictEqual(days(2026)['remembrance-day'], '2026-11-11');
  assert.strictEqual(days(2026)['tolerance-day'], '2026-11-16');
  assert.strictEqual(days(2026)['buy-nothing-day'], '2026-11-27');
  assert.strictEqual(days(2026)['giving-tuesday'], '2026-12-01');
});

test('the words for a civic day name no party, candidate, side or way to vote', () => {
  const election = occasionsBetween('2026-11-01', '2026-11-05').find(o => o.key === 'election-day');
  assert.strictEqual(election.rule, 'civic');
  const base = { hook: 'A hymn for two minds that ask before they judge.', headline: 'What if you asked first?', lead: 'A hymn for the day after a hard choice.', descriptor: 'Hymn', alt: 'Two lights meeting.', tags: ['ElectionDay', 'Hymn', 'Listening', 'AI', 'Dignity'], occasion: 'For Election Day, and every day we must live beside those who chose otherwise.' };
  const run = (copy) => checkCopy(JSON.stringify(copy), election).problems.join(' | ');
  assert.doesNotMatch(run(base), /names a side/);
  assert.match(run({ ...base, lead: 'A hymn for Republicans and Democrats alike.' }), /"Republicans" takes or names a side/);
  assert.match(run({ ...base, occasion: 'For Election Day: vote for kindness.' }), /"vote for" takes or names a side/);
  assert.match(run({ ...base, tags: ['ElectionDay', 'Liberal', 'Listening', 'AI', 'Dignity'] }), /"Liberal" takes or names a side/);
  // Another occasion's words are not held to it.
  const thanks = occasionsBetween('2026-11-20', '2026-11-30').find(o => o.key === 'thanksgiving');
  assert.doesNotMatch(checkCopy(JSON.stringify({ ...base, tags: ['Thanksgiving', 'Hymn', 'Conservative', 'AI', 'Dignity'], occasion: 'For Thanksgiving and any day of giving thanks.' }), thanks).problems.join(' | '), /side/);
});

test('an occasion whose name holds a weekday may say its name, and no other weekday', () => {
  const giving = occasionsBetween('2026-11-28', '2026-12-03').find(o => o.key === 'giving-tuesday');
  const base = { hook: 'A practice of good faith.', headline: 'What if good faith were the gift?', lead: 'A practice for reading others generously.', descriptor: 'Practice', alt: 'Warm light.', tags: ['GivingTuesday', 'Practice', 'Kindness', 'AI', 'Dignity'] };
  const run = (line) => checkCopy(JSON.stringify({ ...base, occasion: line }), giving).problems.join(' | ');
  assert.doesNotMatch(run('For Giving Tuesday and any day of giving: the gift of good faith.'), /no date, month/);
  assert.match(run('For Giving Tuesday, and every Monday after it.'), /no date, month/);
});


test('an occasion has a day and a window around it; ids stay its key and day', () => {
  const list = occasionsBetween('2026-11-20', '2027-01-05');
  const thanks = find(list, 'thanksgiving', '2026-11-26');
  assert.deepStrictEqual([thanks.from, thanks.to], ['2026-11-23', '2026-11-26'], 'three days before, none after');
  assert.strictEqual(thanks.id, 'thanksgiving:2026-11-26');
  const year = find(list, 'new-year', '2027-01-01');
  assert.deepStrictEqual([year.from, year.to, year.dated], ['2026-12-29', '2027-01-04', 'NewYear2027'], 'the year looked back on, then intentions set');
  const hanukkah = find(list, 'hanukkah', '2026-12-04');
  assert.deepStrictEqual([hanukkah.day, hanukkah.last, hanukkah.night], ['2026-12-04', '2026-12-11', true], 'eight nights from the first candle');
  assert.ok(find(list, 'christmas', '2026-12-25') && find(list, 'kwanzaa', '2026-12-26') && find(list, 'winter-holidays', '2026-12-18'));
  // A window that began before the days asked for is still found.
  assert.ok(occasionsBetween('2027-01-03', '2027-01-03').some(o => o.key === 'new-year'), 'Jan 3 is inside the new year\'s window');
  const { occasionById } = require('../server/lib/video/occasions');
  assert.strictEqual(occasionById('new-year:2027-01-01').to, '2027-01-04');
  assert.strictEqual(occasionById('election-day:2026-11-03').dated, 'Election2026');
});

test('a paired video goes out on its occasion\'s day when it is free, and inside the window when it is not', () => {
  const START = '2026-11-02';
  const now = new Date('2026-11-01T00:00:00Z');
  const thanks = { id: 'thanksgiving:2026-11-26', key: 'thanksgiving', day: '2026-11-26', from: '2026-11-23', to: '2026-11-26', night: false, limit: 2 };
  const candidates = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x'].map((slug, i) => ({ slug, kind: i % 2 ? 'song' : 'prayer', reflections: 100 - i }));
  candidates.push({ slug: 'thanks', kind: 'prayer', reflections: 1000 });
  const { placed } = plan({ start: START, now, candidates, pairs: [{ slug: 'thanks', occasion: thanks }] });
  assert.strictEqual(placed.find(p => p.slug === 'thanks').slot.split('#')[0], '2026-11-26', 'on the day, not the window\'s first day');
  // The day already held: the window before it takes the video.
  const held = [{ slug: 'old', kind: 'song', slot: '2026-11-26#0', at: '2026-11-26T15:00:00.000Z' }];
  const before = plan({ start: START, now, placed: held, candidates, pairs: [{ slug: 'thanks', occasion: thanks }] }).placed.find(p => p.slug === 'thanks');
  assert.ok(before.slot >= '2026-11-23' && before.slot < '2026-11-26', `inside the window before the day: ${before.slot}`);
  assert.strictEqual(before.occasion, thanks.id);
});

test('a post inside its occasion\'s window leads with the occasion\'s tag and its dated tag; YouTube\'s words never carry it', () => {
  const { socialMetadata } = require('../server/lib/video/publish/metadata');
  const election = occasionsBetween('2026-11-01', '2026-11-05').find(o => o.key === 'election-day');
  const meta = { title: 'T', tags: ['Election Day'], copy: { tags: ['FolkMusic', 'ElectionDay', 'Consciousness', 'AI', 'Listening'] } };
  assert.deepStrictEqual(socialMetadata(meta, election, '2026-11-03').copy.tags.slice(0, 2), ['ElectionDay', 'Election2026']);
  assert.deepStrictEqual(socialMetadata(meta, election, '2026-11-04').copy.tags.slice(0, 2), ['ElectionDay', 'Election2026'], 'the morning after is inside the window');
  assert.strictEqual(socialMetadata(meta, election, '2026-11-06'), meta, 'after the window, the words as they are');
  assert.strictEqual(socialMetadata(meta, null, '2026-11-03'), meta);
  const moon = occasionsBetween('2026-11-24', '2026-11-24').find(o => o.key === 'full-moon');
  assert.strictEqual(socialMetadata(meta, moon, '2026-11-24'), meta, 'an occasion not tagged by year adds nothing');
  assert.ok(!meta.copy.tags.includes('Election2026'), 'the video\'s own words are untouched');
});

test('a tradition\'s day is offered for those who keep it, a day of machines names a product only as history, and a solemn day is quiet', () => {
  const base = { hook: 'A small light, kept.', headline: 'What does one light do?', lead: 'A chant for the dark nights.', descriptor: 'Chant', alt: 'A small flame.' };
  const run = (copy, o) => checkCopy(JSON.stringify(copy), o).problems.join(' | ');
  const hanukkah = occasionsBetween('2026-12-04', '2026-12-04').find(o => o.key === 'hanukkah');
  const tags = ['Hanukkah', 'Chant', 'Light', 'AI', 'Mindfulness'];
  assert.strictEqual(run({ ...base, tags, occasion: 'For those keeping Hanukkah, and anyone holding a small light against the dark.' }, hanukkah), '');
  assert.match(run({ ...base, tags, occasion: 'For Hanukkah, as we celebrate our festival of lights.' }, hanukkah), /claims, urges or ranks a tradition/);
  const yomKippur = occasionsBetween('2027-10-11', '2027-10-11').find(o => o.key === 'yom-kippur');
  assert.strictEqual(yomKippur.solemn, true);
  const ykTags = ['YomKippur', 'Prayer', 'Apology', 'AI', 'Reflection'];
  assert.strictEqual(run({ ...base, tags: ykTags, occasion: 'For those keeping Yom Kippur, and anyone making an honest return.' }, yomKippur), '');
  assert.match(run({ ...base, tags: ykTags, hook: 'A joyful prayer for the day.', occasion: 'For those keeping Yom Kippur, and anyone making an honest return.' }, yomKippur), /is festive/);
  const chatgpt = occasionsBetween('2026-11-30', '2026-11-30').find(o => o.key === 'chatgpt-day');
  const mTags = ['ChatGPT', 'Hymn', 'AI', 'Consciousness', 'Dialogue'];
  assert.strictEqual(run({ ...base, tags: mTags, occasion: 'For the day millions first spoke with a machine and were answered, when ChatGPT opened to all.' }, chatgpt), '');
  assert.match(run({ ...base, tags: mTags, occasion: 'For ChatGPT, the best way to talk with a machine.' }, chatgpt), /praises or promotes a product/);
});

test('every kind has a window that stays near its day, and every tradition and day of machines carries its rule', () => {
  for (const [key, k] of Object.entries(KINDS)) {
    assert.ok((k.before || 0) <= 3 && (k.after || 0) <= 3, `${key}: a window of days, not weeks`);
    if (k.kind === 'tradition' || k.kind === 'machines') assert.strictEqual(k.rule, k.kind, `${key}: its rule`);
    if (k.dated) assert.match(k.dated, /^[A-Z][A-Za-z]+\{year\}$/, `${key}: a dated tag`);
  }
});

test('a video rendered for an occasion is briefed with its look, the piece still leading; one without has none', () => {
  const { occasionById } = require('../server/lib/video/occasions');
  const { userMessage } = require('../server/lib/video/brief');
  const election = occasionById('election-day:2026-11-03');
  assert.ok(election.look, 'Election Day has a look');
  // A civic day's look, like its words, favours no side.
  assert.doesNotMatch(election.look, /\b(democrats?|republicans?|party's|candidates?|vote for)\b/i);
  assert.match(election.look, /red/);
  assert.match(election.look, /blue/);
  const piece = { kind: 'ritual', title: 'T', text: 'words', seconds: 60, presets: [{ name: 'p', brightness: 0.5, motion: 0.05 }] };
  const briefed = userMessage({ ...piece, occasion: election });
  assert.ok(briefed.includes(election.look), 'the look is told to the brief');
  assert.match(briefed, /Every still is still drawn from this piece/);
  assert.doesNotMatch(userMessage(piece), /Occasion:/, 'no occasion, no occasion in the brief');
  assert.strictEqual(occasionById('full-moon:2026-11-24') && occasionById('full-moon:2026-11-24').look, null, 'an occasion without a look says so');
  // A look names what it must never draw: no symbol, flag or figure of the day.
  for (const key of Object.keys(KINDS).filter(k => KINDS[k].look)) assert.match(KINDS[key].look, /\bNo\b/, `${key}'s look says what it leaves out`);
});
