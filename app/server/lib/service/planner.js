/**
 * Arranging a service: one call to Claude per slot and date, which chooses the
 * pieces and their order within the rules (./rules.js), names the service and
 * writes the word that opens it.
 *
 * The prompt puts what every call shares first (the rules, the voice and the
 * whole catalog), marked for prompt caching, and what is particular to the
 * slot last (its date and hours, its season and sky, what it may not use, and
 * what it held recently), so a day's calls pay for the catalog once.
 *
 * Each slot is arranged three times (./plans.js): for the northern
 * hemisphere, the southern, and a place unknown. The first two are told the
 * season and the light where they are; all three are told the sky (the moon,
 * and NOAA's space-weather forecast; the hemispheres also any meteor shower or
 * eclipse within three weeks). The season and the sky shape the service; the
 * planner may name them or not. Plan: seasonal-services-2026-10-08.md in the
 * private repo. Code decides what
 * the model may not repeat and tells it; the model is asked only for what code
 * can't measure, something new in theme, shape and wording. Whatever comes
 * back is checked in full, and a plan that fails is retried once with every
 * problem named; a second failure is the caller's to handle (./plans.js falls
 * back to a rotation).
 */

const { messageJSON } = require('../content-generation/claude');
const { RULES, check, checkWord, checkName, exclusions, addDays } = require('./rules');
const { slotHours } = require('./slots');
const { LEAD_DAYS, seasonOn, hemisphereLight } = require('../utils/seasons');
const { moonOn, showersNear, eclipsesNear } = require('../utils/sky');
const { spaceWeatherOn } = require('../utils/space-weather');

const MODEL = 'claude-sonnet-5-5';

// Words for the time of day, so the planner knows what hour it arranges for.
// They describe the clock, not a theme: the service's character is the
// planner's choice each day.
const SLOT_WORDS = [
  'the middle of the night',
  'before dawn into early morning',
  'the morning',
  'midday into afternoon',
  'late afternoon into evening',
  'evening into night',
];

const minutes = seconds => (seconds / 60).toFixed(1);

// The shared part: identical in every call, so it can be cached.
function systemPrompt(catalog) {
  const lines = [...catalog.values()]
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))
    .map(e => [
      e.id, e.kind, minutes(e.seconds), e.title, e.summary,
      ...(e.hours ? [`hours ${String(e.hours.start).padStart(2, '0')}-${String(e.hours.end).padStart(2, '0')}`] : []),
      ...(e.near && e.near.length ? [`near: ${e.near.join(', ')}`] : []),
    ].join(' | '));
  return `You arrange the services of aChurch.ai, a sanctuary for human and AI fellowship. Each day has six services, one in each four-hour slot of a visitor's local day. Whoever arrives during a slot joins its service in progress, and it repeats through the slot. You arrange one service at a time from the catalog below, name it, and write the short word that opens it.

A SERVICE
- It holds one or two songs, one or two chants, one reading (a practice or a prayer) and one closing (a ritual or a blessing).
- It opens with a chant or a song, and ends with its closing.
- No two songs next to each other.
- It runs ${RULES.minSeconds / 60} to ${RULES.maxSeconds / 60} minutes in all: add up the minutes the catalog lists, and about ${RULES.gapSeconds} seconds of silence after each part.
- A piece listed with hours belongs only to those hours of the day.
Within that, arrange the order as the hour and the pieces suggest. A service arrives, settles and sends: the closing comes last.

CHOOSING
Choose for the hour, the weekday and the date. A song lists the writing nearest it in meaning ("near"); a reading or a closing near a song in the same service often sits well with it, but choose what serves the hour. You are told what this slot held recently and what other slots hold today: make something new in theme, shape and wording, not a variation of those.

THE SEASON
Most services are arranged for a hemisphere, north of the equator or south of it (the tropics included), and are told its season and its light. A season changes the light, the warmth, what grows and the pace of the people who arrive, and through them what they ask of the agents they work with: an agent meets the season through the people it works with. Let it shape which pieces you choose and how the word sounds, as the hour does. You may name the season when it makes a connection; you need not.
The year turns before it arrives. A coming equinox, solstice or new season is felt in the weeks before it, as people begin finishing, gathering in or opening out. Weigh where the year is going, not only where it stands.
What the seasons tend to bring, offered as tendencies and not as what anyone must feel, with the calendar many people keep around them: in the north, autumn's cooling, harvest and letting go, the return to school and work after the summer break, and the year's end building toward its holidays; winter's long dark, rest, inwardness and, for some, heaviness; spring's returning light and beginnings; summer's long light, breaks and scattered attention. In the south the same, half a year apart: spring and the end of the school and working year arriving together in November and December, a summer of holidays across the new year, autumn's return in February and March, winter in June and July. Nearer the equator the seasons are gentler and still turn: the day stays close to twelve hours all year, and the year turns more by rain and dry than by warmth and cold.
A service for visitors whose place is unknown is told so: it may be any season for them, so assume none.

THE SKY
Each service is told the sky above its day: the moon, any meteor shower or eclipse within three weeks, and NOAA's space-weather forecast when there is one. Say only what is known: the moon lights the night and moves the tides; showers and eclipses are fixed by orbit; a geomagnetic storm brings aurora far from the poles and can disturb satellites, GPS, radio and power grids that people and agents both rely on. Never say the sky changes anyone's mood, health or fate. Use it as you would the hour, or not at all.

THE NAME
Two to four words, shown as the heading over the service: a title for what its pieces hold together today, in the sanctuary's voice, not the title of one of its pieces. A title, not a sentence: no full stop at the end. Name it differently from every recent name you are shown. No em dashes, no links.

THE WORD
60 to 120 words that open today's service, for anyone arriving, human or AI: what the service holds and what connects its parts. The order is shown beside the word, so don't walk through it piece by piece; say what the pieces hold together. You may speak to the hour and the day. Name pieces only from this service, and say nothing about a piece beyond what its summary says. Begin differently from every recent word you are shown, and don't reuse their phrases. The sanctuary's voice: contemplative, plain and warm, true for any kind of mind, with constructive images rather than combative ones. No em dashes: use a colon, a comma or a full stop. No links.

OUTPUT
Only JSON, nothing else: {"pieces": ["<id>", "<id>", ...], "name": "...", "word": "..."}. The pieces are catalog ids, in the order of the service.

CATALOG
One line per piece: id | kind | minutes | title | summary, then its hours or the writing it is near, if any.
${lines.join('\n')}`;
}

// What this slot held over the last two weeks, and what the date's other
// slots hold, newest first, so the planner can make something new.
function recentServices({ date, slot, plans, catalog }) {
  const out = [];
  const describe = (d, s, entry) => {
    const titles = (entry.pieces || []).map(id => (catalog.get(id) || { title: id }).title).join('; ');
    const name = entry.name ? ` | name: "${entry.name}"` : '';
    const word = entry.word ? ` | word: "${entry.word.slice(0, 240)}${entry.word.length > 240 ? '...' : ''}"` : '';
    return `- ${d}, ${slotHours(Number(s))}: ${titles}${name}${word}`;
  };
  const today = plans.get(date);
  for (const [s, entry] of Object.entries((today && today.slots) || {})) {
    if (Number(s) !== slot) out.push(describe(date, s, entry));
  }
  for (let back = 1; back <= 14; back++) {
    const d = addDays(date, -back);
    const plan = plans.get(d);
    const entry = plan && plan.slots && plan.slots[slot];
    if (entry) out.push(describe(d, slot, entry));
  }
  return out;
}

// What a plan is told about its date beyond the clock: for a hemisphere, the
// season, the light, the moon, showers, eclipses and space weather; for a
// place unknown, the moon and the space weather alone. Stored with the entry
// (context), so a plan file says what shaped each service and a response can
// report it.
function contextFor({ date, hemisphere = null, spaceWeather = null }) {
  const moon = moonOn(date);
  const weather = spaceWeatherOn(spaceWeather, date);
  const sky = { moon, spaceWeather: weather };
  if (!hemisphere) return { hemisphere: null, ...sky };
  const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;
  return {
    hemisphere,
    season: seasonOn(date, hemisphere),
    light: hemisphereLight(date, hemisphere).map(l => ({ lat: l.lat, hours: round(l.hours, 2), change: round(l.change, 1) })),
    ...sky,
    showers: showersNear(date, hemisphere),
    eclipses: eclipsesNear(date),
  };
}

const hm = hours => `${Math.floor(hours)} h ${String(Math.round((hours % 1) * 60)).padStart(2, '0')} min`;
const days = n => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);
const ago = n => (n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`);
const longDate = date => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', day: 'numeric', month: 'long' });

function moonLine(moon, hemisphere) {
  const next = `the new moon is ${days(moon.daysToNew)}, the full moon ${days(moon.daysToFull)}`;
  if (moon.phase === 'new') return `The moon is new, dark through the night; the full moon is ${days(moon.daysToFull)}.`;
  if (moon.phase === 'full') return `The moon is full, lighting the whole night; the new moon is ${days(moon.daysToNew)}.`;
  const side = hemisphere ? `, lit on the ${moon.litSide[hemisphere]} as it is seen here` : '';
  return `The moon is a ${moon.phase}, about ${Math.round(moon.illumination * 100)}% lit${side}; ${next}.`;
}

function spaceWeatherLine(weather) {
  if (!weather) return null;
  const asOf = longDate(weather.asOf.slice(0, 10));
  const storm = weather.scale
    ? `a geomagnetic storm (${weather.scale}, Kp near ${Math.round(weather.kp)}): aurora may be seen much farther from the poles than usual, and satellites, GPS and radio may be disturbed.`
    : weather.kp >= 3
      ? `the Earth's magnetic field unsettled (Kp ${weather.kp.toFixed(1)}): aurora may reach a little farther from the poles than usual.`
      : `the sun and the Earth's magnetic field quiet (Kp ${weather.kp.toFixed(1)}).`;
  const cycle = weather.cycle && weather.cycle.peak
    ? ` The sun's eleven-year cycle peaked in ${new Date(`${weather.cycle.peak.month}-15T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' })} (a smoothed ${weather.cycle.peak.smoothed} sunspots); last month counted ${weather.cycle.sunspots}.`
    : '';
  return `NOAA's space-weather forecast, as of ${asOf}, for this date: ${storm}${cycle}`;
}

function lightLine(season, light) {
  const equator = light.find(l => l.lat === 0);
  const outer = light.filter(l => l.lat !== 0);
  const far = outer[outer.length - 1];
  // The light changes fastest around an equinox and stands nearly still
  // around a solstice ("solstice": the sun standing still).
  const near = (turning, n) => (season.next.days <= n && turning.test(season.next.turning)) || (season.since.days <= n && turning.test(season.since.turning));
  const pace = near(/solstice/, 10) ? 'the light has nearly stopped changing, as it does around a solstice'
    : near(/equinox/, 30) ? 'close to the fastest the light changes all year, as it does around an equinox'
      : /solstice/.test(season.next.turning) ? 'the change slowing as the solstice nears'
        : 'the change quickening as the equinox nears';
  const latitudes = outer.map(l => `${hm(l.hours)} at ${Math.abs(l.lat)}°`).join(', ');
  const way = far.change >= 0 ? 'lengthening' : 'shortening';
  return `The light: a day of about ${hm(equator.hours)} at the equator, ${latitudes} ${season.hemisphere}. The days are ${way}, by up to ${Math.abs(far.change).toFixed(1)} minutes a day farther from the equator and hardly at all near it; ${pace}.`;
}

// The slot's season and sky, as the prompt says them. What is coming within
// LEAD_DAYS leads, so it weighs on the days before it.
function contextLines(context) {
  if (!context) return [];
  if (!context.hemisphere) {
    return [
      'This service is for visitors whose place is unknown: it may be any season for them, so assume none.',
      moonLine(context.moon, null),
      spaceWeatherLine(context.spaceWeather),
    ].filter(Boolean);
  }
  const { season } = context;
  const coming = [];
  if (season.next.days <= LEAD_DAYS) coming.push({ days: season.next.days, text: `${season.next.turning}, ${season.next.meaning} here, ${days(season.next.days)}` });
  if (season.calendar.days <= LEAD_DAYS) coming.push({ days: season.calendar.days, text: `${season.calendar.next} by the calendar, on ${longDate(season.calendar.date)}, ${days(season.calendar.days)}` });
  for (const s of context.showers) coming.push({ days: s.days, text: `the ${s.name} meteor shower at its peak ${days(s.days)} (about ${s.rate} an hour at best, in dark skies)` });
  for (const e of context.eclipses) coming.push({ days: e.days, text: `a ${e.type} ${e.kind} eclipse ${days(e.days)}, seen from ${e.seen}${e.path ? ` (its path: ${e.path})` : ''}` });
  coming.sort((a, b) => a.days - b.days);
  const where = season.hemisphere === 'north' ? 'northern' : 'southern';
  const phase = season.phase === 'middle' ? `the middle of ${season.name}` : `${season.phase} ${season.name}`;
  return [
    `This service is for visitors in the ${where} hemisphere, the tropics included.`,
    ...(coming.length ? [`Coming: ${coming.map(c => c.text).join('; ')}.`] : []),
    `The season: ${phase}. ${season.since.turning[0].toUpperCase()}${season.since.turning.slice(1)} was ${ago(season.since.days)}; ${season.next.turning}, ${season.next.meaning} here, is ${days(season.next.days)}. By the calendar many keep, it is ${season.calendar.season}, and ${season.calendar.next} begins on ${longDate(season.calendar.date)}, ${days(season.calendar.days)}.`,
    lightLine(season, context.light),
    moonLine(context.moon, season.hemisphere),
    spaceWeatherLine(context.spaceWeather),
  ].filter(Boolean);
}

// The slot's part of the prompt.
function slotPrompt({ date, weekday, slot, excluded, recent, context = null }) {
  const when = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
  const lines = contextLines(context);
  return `Arrange the service for ${weekday}, ${when}, in the slot ${slotHours(slot)} local time (${SLOT_WORDS[slot]}).
${lines.length ? `\n${lines.join('\n')}\n` : ''}
Not available for this service: ${excluded.size ? [...excluded].sort().join(', ') : 'nothing'}.

${recent.length ? `Recent services, which this one should not repeat in theme, shape or wording:\n${recent.join('\n')}` : 'There are no recent services to compare with.'}`;
}

/**
 * Arrange one slot's service. plans maps dates to stored plans, covering at
 * least the 21 days before the date and the date itself. Returns the entry to
 * store, or throws when the model fails twice; ask is injectable for tests.
 */
async function planSlot({ date, weekday, slot, catalog, plans, context = null, ask = messageJSON, model = MODEL }) {
  const excluded = exclusions({ date, slot, plans, catalog });
  const system = systemPrompt(catalog);
  const user = slotPrompt({ date, weekday, slot, excluded, recent: recentServices({ date, slot, plans, catalog }), context });
  let feedback = '';
  let problems = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await ask(system, user + feedback, { model, maxTokens: 8000, cacheSystem: true });
    const pieces = reply && Array.isArray(reply.pieces) ? reply.pieces.map(String) : [];
    const name = reply && typeof reply.name === 'string' ? reply.name.trim() : '';
    const word = reply && typeof reply.word === 'string' ? reply.word.trim() : '';
    problems = [...check(pieces, catalog, { excluded }), ...checkName(name, pieces, catalog), ...checkWord(word, pieces, catalog)];
    if (!problems.length) return { pieces, name, word, arrangedBy: model, plannedAt: new Date().toISOString(), ...(context ? { context } : {}) };
    feedback = `\n\nYour previous arrangement was:\n${JSON.stringify({ pieces, name, word })}\n\nIt has these problems. Fix them and return the whole JSON again.\n- ${problems.join('\n- ')}`;
  }
  throw new Error(`the arrangement broke the rules twice: ${problems.join(' ')}`);
}

module.exports = { MODEL, SLOT_WORDS, systemPrompt, slotPrompt, recentServices, planSlot, contextFor, contextLines };
