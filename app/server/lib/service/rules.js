/**
 * What a service may hold, and in what shape. Pure: no I/O and no clock, so
 * the planner, the rotation and the tests all apply the same rules.
 *
 * A service holds one or two songs, one or two chants, one reading (a
 * practice or a prayer) and one closing (a ritual or a blessing). It opens
 * with a chant or a song and ends with its closing: it arrives, settles and
 * sends. No two songs in a row. It runs 15 to 40 minutes, and repeats through
 * its slot. church-private/docs/plans/service-hours-2026-10-06.md has why.
 */

const { SLOT_HOURS, slotStart } = require('./slots');
const { SHOWERS } = require('../utils/sky');

const RULES = {
  songs: [1, 2],
  chants: [1, 2],
  readings: [1, 1],
  closings: [1, 1],
  // Measured over the catalog (2026-10-06): a two-song service runs 19
  // minutes at the median and under 26 for nine in ten. A 20-minute floor
  // turned away two in three and pushed every plan toward the longest pieces;
  // at 15, four in five fit.
  minSeconds: 15 * 60,
  maxSeconds: 40 * 60,
  // A held silence after each part, before the next begins.
  gapSeconds: 8,
};

// The part of a service each kind of piece can fill.
const CLASS = { song: 'songs', chant: 'chants', practice: 'readings', prayer: 'readings', ritual: 'closings', blessing: 'closings' };

// How long before a piece may return in the same slot. The two large pools
// can rest three weeks; songs (28) and chants (12) are too few for more than
// not repeating yesterday's. Nothing repeats within one date, in any slot.
const WINDOW_DAYS = { readings: 21, closings: 21, songs: 1, chants: 1 };

// 'YYYY-MM-DD' moved by whole days.
function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// A service's running time: its parts and the silence after each.
function serviceSeconds(entries) {
  return entries.reduce((sum, e) => sum + e.seconds, 0) + RULES.gapSeconds * entries.length;
}

/**
 * Whether a piece could ever be in a service: with the shortest piece of each
 * other part a service needs, it still fits the longest service. Rules out
 * what is too long to hold, such as a 37-minute prayer, without a list.
 */
function fits(entry, entries) {
  const shortest = cls => Math.min(...entries.filter(e => CLASS[e.kind] === cls).map(e => e.seconds));
  const others = ['songs', 'chants', 'readings', 'closings'].filter(cls => cls !== CLASS[entry.kind]);
  const total = entry.seconds + others.reduce((sum, cls) => sum + shortest(cls), 0) + RULES.gapSeconds * 4;
  return total <= RULES.maxSeconds;
}

/**
 * Every way a service breaks the rules, at once, so a model asked to fix one
 * is told all of them. ids are in order; catalog maps id to entry.
 */
function check(ids, catalog, { excluded = new Set() } = {}) {
  const issues = [];
  if (!Array.isArray(ids) || ids.length === 0) return ['The service has no pieces.'];
  const unknown = ids.filter(id => !catalog.has(id));
  if (unknown.length) issues.push(`Not in the catalog: ${unknown.join(', ')}.`);
  const repeated = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (repeated.length) issues.push(`A piece appears twice: ${[...new Set(repeated)].join(', ')}.`);
  const unavailable = ids.filter(id => excluded.has(id));
  if (unavailable.length) issues.push(`Not available for this service (used too recently): ${unavailable.join(', ')}.`);
  if (unknown.length) return issues;

  const entries = ids.map(id => catalog.get(id));
  const count = cls => entries.filter(e => CLASS[e.kind] === cls).length;
  for (const cls of ['songs', 'chants', 'readings', 'closings']) {
    const [min, max] = RULES[cls];
    const n = count(cls);
    if (n < min || n > max) issues.push(`It holds ${n} ${cls}; it needs ${min === max ? min : `${min} or ${max}`}.`);
  }
  if (!['chant', 'song'].includes(entries[0].kind)) issues.push(`It opens with a ${entries[0].kind}; it must open with a chant or a song.`);
  if (CLASS[entries[entries.length - 1].kind] !== 'closings') issues.push('It must end with its ritual or blessing.');
  if (entries.some((e, i) => i > 0 && e.kind === 'song' && entries[i - 1].kind === 'song')) issues.push('Two songs are next to each other.');
  const seconds = serviceSeconds(entries);
  if (seconds < RULES.minSeconds || seconds > RULES.maxSeconds) {
    issues.push(`It runs ${Math.round(seconds / 60)} minutes, with a short silence after each part; it must run ${RULES.minSeconds / 60} to ${RULES.maxSeconds / 60}.`);
  }
  return issues;
}

// What the sanctuary asks of anything the planner writes (`what` names it in
// the problems): no em dash, no link, and no title of a piece the service
// doesn't hold (titles of three words or more; shorter ones, like the song
// "Always Open", are ordinary words in a sentence).
function voiceIssues(text, what, ids, catalog) {
  const issues = [];
  if (/—/.test(text)) issues.push(`The ${what} uses an em dash; use a colon, a comma or a full stop.`);
  if (/https?:\/\//.test(text)) issues.push(`The ${what} contains a link; it should not.`);
  const held = new Set(ids);
  const foreign = [...catalog.values()]
    .filter(e => !held.has(e.id) && e.title.split(/\s+/).length >= 3 && text.includes(e.title))
    .map(e => e.title);
  if (foreign.length) issues.push(`The ${what} names pieces this service doesn't hold: ${foreign.join(', ')}.`);
  return issues;
}

/**
 * The word introducing a service: a length a listener reads before pressing
 * play, and the sanctuary's voice (voiceIssues).
 */
function checkWord(word, ids, catalog) {
  if (typeof word !== 'string' || !word.trim()) return ['There is no word.'];
  const issues = [];
  const words = word.trim().split(/\s+/).length;
  if (words < 40 || words > 160) issues.push(`The word is ${words} words; it should be 60 to 120.`);
  return [...issues, ...voiceIssues(word, 'word', ids, catalog)];
}

/**
 * The service's name, the heading over it: two to four words, a title rather
 * than a sentence, so no full stop at its end, and checked like the word.
 */
function checkName(name, ids, catalog) {
  if (typeof name !== 'string' || !name.trim()) return ['There is no name.'];
  const issues = [];
  const words = name.trim().split(/\s+/).length;
  if (words < 2 || words > 4) issues.push(`The name is ${words} words; it should be 2 to 4.`);
  if (/\.$/.test(name.trim())) issues.push('The name ends with a full stop; it is a title.');
  return [...issues, ...voiceIssues(name, 'name', ids, catalog)];
}

const PLANETS = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];

/**
 * What the name and word say of the sky and the Earth, against what the plan
 * was told (planner.js contextFor), so a service never tells its visitors
 * something false about the night above them: a planet, a meteor shower, an
 * eclipse, a Voyager, El Niño or La Niña named only when the plan was told
 * of it; the evening or morning star only when Venus is seen then; a storm,
 * aurora, radio blackouts or a radiation storm only when NOAA forecast them;
 * the moon called full or new tonight only on its night. Narrow on purpose:
 * a false alarm costs a retry and could cost a service, so only plain claims
 * are read, and the sky may always go unsaid. Nothing for a plan told no
 * context. Plan: sky-and-earth-sources-2026-10-08.md in the private repo.
 */
function checkSky(text, context) {
  if (!context || typeof text !== 'string') return [];
  const says = re => re.test(text);
  const issues = [];
  const planets = context.planets || {};
  const visible = planets.visible || [];
  const told = new Set([...visible.map(p => p.name), ...(planets.events || []).map(e => e.body)]);
  for (const p of PLANETS) {
    if (says(new RegExp(`\\b${p}\\b`)) && !told.has(p)) issues.push(`${p}, which the sky you were told does not hold`);
  }
  const venus = visible.find(p => p.name === 'Venus');
  if (says(/\bevening star\b/i) && !(venus && /evening|all night/.test(venus.when))) issues.push('the evening star, though Venus is not seen after sunset from here');
  if (says(/\bmorning star\b/i) && !(venus && /morning|all night/.test(venus.when))) issues.push('the morning star, though Venus is not seen before dawn from here');
  const { moon } = context;
  const asIs = moon && (moon.phase === 'full' || moon.phase === 'new' ? moon.phase : `a ${moon.phase}`);
  if (moon && moon.phase !== 'full' && says(/\bmoon is (?:now )?full\b|\bfull moon (?:tonight|today)\b|\b(?:tonight|today)'?s full moon\b|\bunder (?:a|the|this) full moon\b/i)) issues.push(`a full moon, though the moon is ${asIs}`);
  if (moon && moon.phase !== 'new' && says(/\bmoon is (?:now )?new\b|\bnew moon (?:tonight|today)\b|\b(?:tonight|today)'?s new moon\b/i)) issues.push(`a new moon, though the moon is ${asIs}`);
  const showers = context.showers || [];
  for (const s of SHOWERS) {
    if (says(new RegExp(`\\b${s.name}\\b`)) && !showers.some(n => n.name === s.name)) issues.push(`the ${s.name}, which are not near`);
  }
  if (says(/\bmeteor/i) && !showers.length) issues.push('meteors, though no shower is near');
  if (says(/\beclipse/i) && !(context.eclipses || []).length) issues.push('an eclipse, though none is near');
  const voyagers = context.voyagers || [];
  for (const craft of ['Voyager 1', 'Voyager 2']) {
    if (says(new RegExp(`\\b${craft}\\b`)) && !voyagers.some(v => v.craft === craft)) issues.push(`${craft}, which you were not told of`);
  }
  if (says(/\bVoyagers?\b(?! [12]\b)/) && !voyagers.length) issues.push('the Voyagers, which you were not told of');
  const sw = context.spaceWeather;
  if (says(/\b(?:geomagnetic|magnetic|solar|space) storms?\b/i) && !(sw && sw.scale)) issues.push('a storm, though NOAA forecasts none');
  if (says(/\baurora/i) && !(sw && (sw.scale || sw.kp >= 3))) issues.push('aurora, though NOAA forecasts the field quiet');
  if (says(/\bradio blackouts?\b/i) && !(sw && sw.radio && (sw.radio.minor >= 25 || sw.radio.major >= 25))) issues.push('radio blackouts, which NOAA does not expect');
  if (says(/\bradiation storms?\b/i) && !(sw && sw.radiation && sw.radiation.chance >= 10)) issues.push('a radiation storm, which NOAA does not expect');
  const enso = context.earth && context.earth.enso;
  const outlook = enso ? `${enso.status} ${enso.synopsis}` : '';
  for (const [name, re] of [['El Niño', /\bEl Ni[nñ]o\b/i], ['La Niña', /\bLa Ni[nñ]a\b/i]]) {
    if (re.test(text) && !re.test(outlook)) issues.push(`${name}, which NOAA's outlook does not report`);
  }
  return issues.length ? [`The name or word speaks of ${issues.join('; ')}. Say only what you were told of the sky and the Earth, or leave them unsaid.`] : [];
}

// Whether a piece's `hours:` (lib/music/companions.js parseHours, which may
// wrap midnight) reach into a slot. A piece without hours fits any slot.
function inSlot(hours, slot) {
  if (!hours) return true;
  for (let h = slotStart(slot); h < slotStart(slot) + SLOT_HOURS; h++) {
    if (hours.start < hours.end ? h >= hours.start && h < hours.end : h >= hours.start || h < hours.end) return true;
  }
  return false;
}

/**
 * What a slot can't use on a date: a piece whose hours lie outside the slot,
 * anything in the date's other slots, and anything this slot held within its
 * kind's window. plans maps a date to its stored plan ({ slots: { [slot]:
 * { pieces } } }). Where a window would leave a part with fewer pieces than a
 * service needs, that window gives way for that part; the other two never do.
 */
function exclusions({ date, slot, plans, catalog }) {
  const sameDate = new Set([...catalog.values()].filter(e => !inSlot(e.hours, slot)).map(e => e.id));
  const plan = plans.get(date);
  for (const [s, entry] of Object.entries((plan && plan.slots) || {})) {
    if (Number(s) !== slot) for (const id of entry.pieces || []) sameDate.add(id);
  }
  const byWindow = new Map(Object.keys(WINDOW_DAYS).map(cls => [cls, new Set()]));
  const longest = Math.max(...Object.values(WINDOW_DAYS));
  for (let back = 1; back <= longest; back++) {
    const earlier = plans.get(addDays(date, -back));
    const entry = earlier && earlier.slots && earlier.slots[slot];
    for (const id of (entry && entry.pieces) || []) {
      const e = catalog.get(id);
      const cls = e && CLASS[e.kind];
      if (cls && back <= WINDOW_DAYS[cls]) byWindow.get(cls).add(id);
    }
  }
  const excluded = new Set(sameDate);
  for (const [cls, ids] of byWindow) {
    const pool = [...catalog.values()].filter(e => CLASS[e.kind] === cls && !sameDate.has(e.id));
    const left = pool.filter(e => !ids.has(e.id)).length;
    if (left >= RULES[cls][1]) for (const id of ids) excluded.add(id);
  }
  return excluded;
}

// A stable order for a date and slot: the same inputs order a pool the same
// way, and the next date orders it afresh. FNV-1a, for a stable spread.
function rank(seed, id) {
  let h = 0x811c9dc5;
  for (const ch of `${seed}|${id}`) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return h;
}

/**
 * The service a slot holds when no plan was made for it: a chant, a song, a
 * reading, a song and a closing, each pool in a stable order for the date and
 * slot, skipping what is excluded. The reading and the closing come first in
 * that order, since they rotate through the largest pools; the songs and the
 * chant are then whichever make it fit the rules, with one song if two run
 * long. Deterministic, so everyone in the slot gets the same.
 */
function rotation({ date, slot, catalog, excluded = new Set() }) {
  const seed = `${date}|${slot}`;
  const pool = cls => [...catalog.values()]
    .filter(e => CLASS[e.kind] === cls && !excluded.has(e.id))
    .sort((a, b) => rank(seed, a.id) - rank(seed, b.id) || a.id.localeCompare(b.id));
  const [chants, songs, readings, closings] = ['chants', 'songs', 'readings', 'closings'].map(pool);
  if (!chants.length || !songs.length || !readings.length || !closings.length) return null;
  const fitting = shape => {
    const ids = shape.map(e => e.id);
    return check(ids, catalog, { excluded }).length === 0 ? ids : null;
  };
  for (const reading of readings) {
    for (const closing of closings) {
      for (const chant of chants.slice(0, 2)) {
        for (let i = 0; i < songs.length; i++) {
          for (let j = i + 1; j < songs.length; j++) {
            const ids = fitting([chant, songs[i], reading, songs[j], closing]);
            if (ids) return ids;
          }
          const ids = fitting([chant, songs[i], reading, closing]);
          if (ids) return ids;
        }
      }
    }
  }
  return null;
}

module.exports = { RULES, CLASS, WINDOW_DAYS, addDays, serviceSeconds, fits, check, checkWord, checkName, checkSky, inSlot, exclusions, rotation };
