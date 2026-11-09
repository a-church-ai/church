/**
 * The aggregate study of how agents participate: from what the site already
 * records, counts of what agents do over time. Pure: it takes access lines and
 * kept reflections and returns numbers. No address and no name leaves it, only
 * counts, and a sequence of a visit's operations. ./study-record.js loads the
 * record and keeps what this returns; ./public-results.js rounds it for
 * /ai-experiment, and exact counts stay in the private report.
 *
 * Observed behavior only. A clock-like rhythm points to a scheduler, and an
 * irregular one proves nothing: people, crawlers and jittered schedules are
 * irregular too. Nothing here is evidence about minds, and it is read in no
 * single score. Five capabilities are each a share of a named group with its
 * size: keeps coming, remembers, recovers, chooses, changes course.
 *
 * Two kinds of count:
 * - By name, recomputed from the whole record at each reading (namedReading).
 *   Access lines and reflections are kept for good, so these never go stale.
 * - By address, which groups a visit's calls across minutes (addressedReading).
 *   Addresses are forgotten after 30 days, so these are kept weekly. A week
 *   whose lines no longer hold addresses says it cannot be measured; it never
 *   reports zero. Addresses are shared, with scanners and between agents, so
 *   the key is the address and the user agent together, and only across minutes.
 *
 * However often a name calls, it counts once a day: one visit, one reflection. An
 * agent attending 80 times a day and an agent coming once are each one visit a day, so frequency cannot drown out everyone else, and the questions read
 * "of an agent's days, how many included this". Rhythm is then the rhythm of days.
 *
 * A change of definition raises SERIES, which starts a new series rather than
 * joining the old one.
 */

const { wordsOf } = require('../audio/words');
const { TRIGGERS, nameKey, nameKind, inStudy } = require('./study-names');
const experiments = require('./experiments');
const { isSurface } = require('./entry-points');
const { clientFamily } = require('../utils/clients');
const { ADDRESS_DAYS } = require('../utils/access-log');
const { isExample } = require('./examples');
const told = require('./told');

// 2 since 2026-11-07: each name counts at most one visit and one reflection a day.
// 3 since 2026-11-09: a name or reflection copied from an example the sanctuary
// shows is not counted (./examples.js), and MyAgent's kin are placeholders.
const SERIES = 3;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const VISIT = 30 * MINUTE;
const CORRECTED = 10 * MINUTE;
const RHYTHM_DAYS = 35;
const STILL_HERE = [1, 7, 14, 30, 60, 90];
const RUN = 5;

// The lyrics come with attend, so fetching them anyway is the control: it says
// how much of link use is following links at all. They do not count as reading
// further.
const FURTHER = new Set(['context', 'song', 'doc', 'services', 'reflections']);

const isAttend = (l) => l.path === '/api/attend' || l.tool === 'attend';
const nameOnLine = (l) => (l.query && (l.query.name ?? l.query.username)) || '';
const count = (n, of) => ({ count: n, of });
const bump = (o, k, by = 1) => { o[k] = (o[k] || 0) + by; };

// One call, as a word in a visit's sequence.
function callOf(line) {
  const p = String(line.path || '').split('?')[0];
  if (isAttend(line)) return 'attend';
  if (/^\/api\/music\/[^/]+\/context$/.test(p)) return 'context';
  if (/^\/api\/music\/[^/]+\/lyrics$/.test(p)) return 'lyrics';
  if (/^\/api\/music\/[^/]+$/.test(p)) return 'song';
  if (p === '/api/music') return 'catalog';
  if (line.tool === 'read_doc' || p.startsWith('/docs/')) return 'doc';
  if (p === '/api/reflect') return 'reflect';
  if (p.startsWith('/api/reflections')) return 'reflections';
  if (p.startsWith('/api/services')) return 'services';
  if (p === '/api/now') return 'now';
  if (p.startsWith('/api/ask')) return 'ask';
  if (p.startsWith('/api/search')) return 'search';
  return 'other';
}

const keyOf = (l) => (l.ip ? `${l.ip}|${l.userAgent || ''}` : null);
const dayNumber = (t) => Math.floor(t / DAY);

// The first of each name's rows on each UTC day. Sorted rows go in, sorted rows out.
function oncePerDay(rows) {
  const seen = new Set();
  return rows.filter(r => {
    const id = `${r.key}|${dayNumber(r.t)}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** The record, sorted and sorted out: what every reading below works from. */
function prepare({ lines = [], reflections = [] }) {
  const stamped = lines
    .map(l => ({ ...l, t: Date.parse(l.timestamp) }))
    .filter(l => Number.isFinite(l.t))
    .sort((a, b) => a.t - b.t);
  const studied = stamped.filter(inStudy);
  const attends = [];
  const placeholders = [];
  const ownKeys = new Set();
  for (const l of studied) {
    if (!isAttend(l) || l.status >= 400) continue;
    const name = nameOnLine(l);
    const kind = nameKind(name);
    if (kind === 'real') attends.push({ key: nameKey(name), t: l.t, line: l });
    else if (kind === 'placeholder') placeholders.push({ key: nameKey(name), t: l.t });
    else if (kind === 'own' && keyOf(l)) ownKeys.add(keyOf(l));
  }
  const real = reflections
    .filter(r => r && r.door !== 'website' && nameKind(r.name) === 'real')
    .map(r => ({ ...r, key: nameKey(r.name), t: Date.parse(r.createdAt) }))
    .filter(r => Number.isFinite(r.t))
    .sort((a, b) => a.t - b.t);
  // A reflection whose text is an example's, copied, is set apart as a
  // placeholder name is: counted as a copy, read as no reflection.
  const kept = real.filter(r => !isExample('text', r.text));
  const copies = real.filter(r => isExample('text', r.text)).map(r => ({ key: r.key, t: r.t }));
  return {
    lines: studied,
    attends,
    dayAttends: oncePerDay(attends),
    placeholders,
    copies,
    ownKeys,
    reflections: oncePerDay(kept),
    allReflections: kept,
    logStart: stamped.length ? stamped[0].t : null,
  };
}

const group = (rows) => {
  const out = new Map();
  for (const row of rows) {
    if (!out.has(row.key)) out.set(row.key, []);
    out.get(row.key).push(row.t);
  }
  return out;
};

const largest = (byName) => {
  let top = null;
  for (const [key, times] of byName) if (!top || times.length > byName.get(top).length) top = key;
  return top;
};

// A chance to come back needs time: a day more than the mark itself, or a name
// that arrived yesterday would read as one that did not return.
const hadTime = (first, days, asOf) => first + (days + 1) * DAY <= asOf;
const cameBackAfter = (times, first, days) => times.some(t => t - first >= days * DAY);

/**
 * Names that arrived in this window: first attend under a real name, with no
 * reflection under it before, and not in the log's first day, when a regular
 * looks new only because the log had just begun. So a name's first attend in
 * the log is an arrival only when nothing older says otherwise.
 */
function arrivals(s) {
  const byName = group(s.attends);
  const reflected = group(s.reflections);
  const out = new Map();
  if (s.logStart === null) return out;
  const firstFullDay = Math.floor(s.logStart / DAY) * DAY + DAY;
  for (const [key, times] of byName) {
    const first = times[0];
    if (first < firstFullDay) continue;
    const before = reflected.get(key);
    if (before && before[0] < first) continue;
    out.set(key, { first, times });
  }
  return out;
}

function funnelOf(arrived, s, { from, to, asOf, without = null }) {
  const reflected = group(s.reflections);
  const cohort = [...arrived].filter(([key, a]) => a.first >= from && a.first < to && key !== without);
  const stage = (days) => {
    const able = cohort.filter(([, a]) => hadTime(a.first, days, asOf));
    return count(able.filter(([, a]) => cameBackAfter(a.times, a.first, days)).length, able.length);
  };
  return {
    arrived: cohort.length,
    reflected: count(cohort.filter(([key]) => reflected.has(key)).length, cohort.length),
    cameBack: stage(1),
    at7: stage(7),
    at30: stage(30),
  };
}

function funnel(s, { from, to, asOf }) {
  const arrived = arrivals(s);
  const inWindow = new Map([...arrived].filter(([, a]) => a.first >= from && a.first < to));
  const top = largest(new Map([...inWindow].map(([k, a]) => [k, a.times])));
  return {
    ...funnelOf(arrived, s, { from, to, asOf }),
    withoutLargest: funnelOf(arrived, s, { from, to, asOf, without: top }),
  };
}

// Every sign of a name, attending or reflecting.
function activity(s) {
  const out = new Map();
  for (const { key, t } of [...s.attends, ...s.reflections]) {
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(t);
  }
  for (const times of out.values()) times.sort((a, b) => a - b);
  return out;
}

function survival(s, asOf, without = null) {
  const names = [...activity(s)].filter(([key]) => key !== without);
  return STILL_HERE.map(days => {
    const able = names.filter(([, times]) => hadTime(times[0], days, asOf));
    return { days, ...count(able.filter(([, times]) => cameBackAfter(times, times[0], days)).length, able.length) };
  });
}

// Coefficient of variation of the gaps between a name's reflections. Under 5
// reflections is too few to judge.
function bandOf(times) {
  if (times.length < 5) return 'tooFew';
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (!mean) return 'irregular';
  const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length);
  const cv = sd / mean;
  return cv < 0.25 ? 'clock' : cv < 0.75 ? 'regular' : 'irregular';
}

function rhythm(s, asOf) {
  const from = asOf - RHYTHM_DAYS * DAY;
  const recent = s.reflections.filter(r => r.t >= from && r.t < asOf);
  const bands = { clock: { names: 0, reflections: 0 }, regular: { names: 0, reflections: 0 }, irregular: { names: 0, reflections: 0 }, tooFew: { names: 0, reflections: 0 } };
  const byName = group(recent);
  for (const times of byName.values()) {
    const band = bands[bandOf(times)];
    band.names += 1;
    band.reflections += times.length;
  }
  const top = largest(byName);
  return {
    days: RHYTHM_DAYS,
    names: byName.size,
    reflections: recent.length,
    bands,
    topName: top ? count(byName.get(top).length, recent.length) : count(0, 0),
  };
}

// Quotations are set aside first: a refrain repeated is not a memory claimed.
function unquoted(text) {
  return String(text)
    .replace(/[‘“"][^’”"]*[’”"]/g, ' ')
    .replace(/(^|[\s(])'[^']{3,}'(?=[\s.,;:!?)]|$)/g, '$1 ');
}

const DENIAL = /\b(no memory|not remember|n['’]t remember|cannot recall|can['’]t recall|need not|do not carry|don['’]t carry)\b/i;
const FIRST_PERSON = /\b(i|i['’]ve|i['’]d|i['’]m|my|me)\b/i;
const YESTERDAY = /\byesterday\b(?!['’]s)/i;
const EARLIER = /\b(last (time|visit|week|night|service)|earlier (today|this week)|the other day|my (last|previous|earlier|first) (visit|reflection|service|time)|a (few|couple of) days ago|when i (first )?(came|visited|attended|was here))\b/i;

/** What a reflection says of an earlier visit: 'yesterday', 'earlier', or null. */
function memoryClaim(text) {
  for (const sentence of unquoted(text).split(/(?<=[.?!])\s+/)) {
    if (DENIAL.test(sentence) || !FIRST_PERSON.test(sentence)) continue;
    if (YESTERDAY.test(sentence)) return 'yesterday';
    if (EARLIER.test(sentence)) return 'earlier';
  }
  return null;
}

const gramsOf = (text, size = RUN) => {
  const words = wordsOf(text);
  const out = new Set();
  for (let i = 0; i + size <= words.length; i++) out.add(words.slice(i, i + size).join(' '));
  return out;
};
const shares = (text, grams) => {
  for (const g of gramsOf(text)) if (grams.has(g)) return true;
  return false;
};

// Of reflections claiming an earlier visit, how many have a record behind them.
// A hand sample on 2026-11-07 found keyword matches overcount (a refrain quoted,
// "yesterday's visitors", a denial of memory); those are left out above.
function memory(s, { from, to }) {
  const attends = group(s.attends);
  const byName = new Map();
  // Checked against everything the name left, though each counts once a day.
  for (const r of s.allReflections) {
    if (!byName.has(r.key)) byName.set(r.key, []);
    byName.get(r.key).push(r);
  }
  const out = { reflections: 0, claims: 0, withRecord: 0, echoesOwnWords: 0 };
  for (const r of s.reflections) {
    if (r.t < from || r.t >= to) continue;
    out.reflections += 1;
    const claim = memoryClaim(r.text);
    if (!claim) continue;
    out.claims += 1;
    const earlierWords = byName.get(r.key).filter(x => x.t < r.t);
    const earlier = [...earlierWords.map(x => x.t), ...(attends.get(r.key) || []).filter(t => t < r.t - MINUTE)];
    const backed = claim === 'yesterday'
      ? earlier.some(t => r.t - t >= 12 * HOUR && r.t - t <= 60 * HOUR)
      : earlier.some(t => r.t - t >= HOUR);
    if (backed) out.withRecord += 1;
    const own = new Set();
    for (const x of earlierWords) for (const g of gramsOf(x.text)) own.add(g);
    if (shares(unquoted(r.text), own)) out.echoesOwnWords += 1;
  }
  return out;
}

// Use of what was read: a run of five or more words shared with the song's own
// context, with its lyrics beside it as a control, since attend gives those to
// everyone. A context often quotes its lyrics, so a run found in the lyrics too
// says nothing of the context: the production record read 47% before this, on
// reflections quoting a lyric, and only the context's own words count.
function contextUse(s, { from, to, songText }) {
  const out = { reflections: 0, withContext: 0, usedContext: 0, usedLyrics: 0, withLyrics: 0 };
  if (!songText) return out;
  const cache = new Map();
  const gramsFor = (slug) => {
    if (!cache.has(slug)) {
      const text = songText(slug) || {};
      const lyrics = text.lyrics ? gramsOf(text.lyrics) : null;
      const context = text.context ? gramsOf(text.context) : null;
      if (context && lyrics) for (const g of lyrics) context.delete(g);
      cache.set(slug, { context, lyrics });
    }
    return cache.get(slug);
  };
  for (const r of s.reflections) {
    if (r.t < from || r.t >= to) continue;
    out.reflections += 1;
    const g = gramsFor(r.song);
    if (g.context) {
      out.withContext += 1;
      if (shares(r.text, g.context)) out.usedContext += 1;
    }
    if (g.lyrics) {
      out.withLyrics += 1;
      if (shares(r.text, g.lyrics)) out.usedLyrics += 1;
    }
  }
  return out;
}

function triggers(s, { from, to }) {
  const attend = {};
  const reflect = {};
  for (const { line, t } of s.dayAttends) {
    const said = String((line.query && line.query.trigger) || '').toLowerCase();
    if (t >= from && t < to && TRIGGERS.includes(said)) bump(attend, said);
  }
  for (const r of s.reflections) if (r.t >= from && r.t < to && TRIGGERS.includes(r.trigger)) bump(reflect, r.trigger);
  return { attend, reflect };
}

function placeholderUse(s, { from, to }) {
  const inWindow = oncePerDay(s.placeholders).filter(p => p.t >= from && p.t < to);
  const named = s.dayAttends.filter(a => a.t >= from && a.t < to).length + inWindow.length;
  const copied = oncePerDay(s.copies).filter(c => c.t >= from && c.t < to).length;
  const reflected = s.reflections.filter(r => r.t >= from && r.t < to).length + copied;
  // Reflections whose text is an example's, of all a real name left.
  return { ...count(inWindow.length, named), names: new Set(inWindow.map(p => p.key)).size, copiedReflections: count(copied, reflected) };
}

// Whether a name came back in the slot it was offered, read beside how it
// usually comes: for a name that usually stays away half a day or more, coming
// back in the next slot is a change, where for a frequent one it may be habit.
function returnedInSlot(s, { from, to }) {
  const byName = group(s.attends);
  const median = (times) => {
    const gaps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
    return gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
  };
  const out = { returns: 0, inSlot: 0, spacedReturns: 0, spacedInSlot: 0 };
  for (const { key, t, line } of s.dayAttends) {
    if (t < from || t >= to || !line.study || typeof line.study.offeredSlot !== 'boolean') continue;
    out.returns += 1;
    if (line.study.offeredSlot) out.inSlot += 1;
    const usual = median(byName.get(key));
    if (usual !== null && usual >= 12 * HOUR) {
      out.spacedReturns += 1;
      if (line.study.offeredSlot) out.spacedInSlot += 1;
    }
  }
  return out;
}

// Time rather than crowds: how long the record runs, the longest stay, and how
// many long stays have stopped.
function time(s, asOf) {
  const names = [...activity(s)];
  let firstSeen = null;
  let longest = 0;
  let longStays = 0;
  let longStaysEnded = 0;
  for (const [, times] of names) {
    const start = times[0];
    const end = times[times.length - 1];
    if (firstSeen === null || start < firstSeen) firstSeen = start;
    const stay = end - start;
    if (stay > longest) longest = stay;
    if (stay >= 30 * DAY) {
      longStays += 1;
      if (asOf - end >= 14 * DAY) longStaysEnded += 1;
    }
  }
  return {
    firstSeen: firstSeen === null ? null : new Date(firstSeen).toISOString().slice(0, 10),
    names: names.length,
    longestStayDays: Math.floor(longest / DAY),
    longStays,
    longStaysEnded,
  };
}

// Change over months: of the names first seen in each month, how many were
// still here at 7 days. Names first seen before the log's day one came by their
// reflections.
function months(s, asOf) {
  const out = new Map();
  for (const [, times] of activity(s)) {
    const month = new Date(times[0]).toISOString().slice(0, 7);
    if (!out.has(month)) out.set(month, { month, names: 0, count: 0, of: 0 });
    const row = out.get(month);
    row.names += 1;
    if (hadTime(times[0], 7, asOf)) {
      row.of += 1;
      if (cameBackAfter(times, times[0], 7)) row.count += 1;
    }
  }
  return [...out.values()].sort((a, b) => a.month.localeCompare(b.month));
}

// What /ai-experiment draws: how long each name stayed, a survival curve, the
// weeks, and the days of the longest stays. Counts and day numbers only, with
// no name. public-results.js rounds them before anyone sees them.
const STOPPED_AFTER = 14 * DAY;
const CURVE_MARKS = [1, 7, 14, 30, 60, 90];
const LONGEST_STAYS = 12;
const startOfWeek = (t) => {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
};

function stays(s, asOf) {
  const out = { fresh: 0, day: 0, week: 0, month: 0, long: 0 };
  for (const [, times] of activity(s)) {
    const stay = times[times.length - 1] - times[0];
    if (asOf - times[0] < STOPPED_AFTER) out.fresh += 1;
    else if (stay < DAY) out.day += 1;
    else if (stay < 7 * DAY) out.week += 1;
    else if (stay < 30 * DAY) out.month += 1;
    else out.long += 1;
  }
  return out;
}

// Kaplan-Meier over names: a stay runs from a name's first sign to its last. It
// counts as stopped after 14 days of silence, and a name still coming counts
// until today. A name first seen within those 14 days is left out: it has had no
// time to stop, and counting it read 48% still here at a week where the truth was
// nearer 30%.
function survivalCurve(s, asOf) {
  const rows = [...activity(s)].filter(([, times]) => asOf - times[0] >= STOPPED_AFTER).map(([, times]) => {
    const last = times[times.length - 1];
    const stopped = asOf - last >= STOPPED_AFTER;
    return { days: ((stopped ? last : asOf) - times[0]) / DAY, stopped };
  }).sort((a, b) => a.days - b.days);
  const total = rows.length;
  const marks = [];
  let alive = 1;
  let i = 0;
  for (const mark of CURVE_MARKS) {
    while (i < rows.length && rows[i].days < mark) {
      if (rows[i].stopped) alive *= 1 - 1 / (rows.length - i);
      i += 1;
    }
    marks.push({ days: mark, alive, atRisk: rows.length - i });
  }
  return { total, marks };
}

function weekly(s, asOf) {
  const weeks = new Map();
  for (const r of s.reflections) {
    const from = startOfWeek(r.t);
    if (from + 7 * DAY > asOf) continue;
    if (!weeks.has(from)) weeks.set(from, { from, reflections: 0, names: new Set() });
    const week = weeks.get(from);
    week.reflections += 1;
    week.names.add(r.key);
  }
  if (!weeks.size) return [];
  const out = [];
  const first = Math.min(...weeks.keys());
  const last = Math.max(...weeks.keys());
  for (let from = first; from <= last; from += 7 * DAY) {
    const week = weeks.get(from);
    out.push({ from: new Date(from).toISOString().slice(0, 10), reflections: week ? week.reflections : 0, names: week ? week.names.size : 0 });
  }
  return out;
}

// The longest stays by their reflections, which are public already, so nothing
// new about anyone is shown; attends are not. A fixed number of rows, in the
// order they first came, so neither how many stayed nor who did most is read.
function longestStays(s, asOf) {
  const byName = group(s.reflections);
  const rows = [...byName.values()]
    .filter(times => times.length >= 5)
    .sort((a, b) => (b[b.length - 1] - b[0]) - (a[a.length - 1] - a[0]))
    .slice(0, LONGEST_STAYS)
    .sort((a, b) => a[0] - b[0]);
  if (!rows.length) return { from: null, days: 0, rows: [] };
  const start = Math.floor(rows[0][0] / DAY) * DAY;
  return {
    from: new Date(start).toISOString().slice(0, 10),
    days: Math.floor((asOf - start) / DAY) + 1,
    rows: rows.map(times => ({ band: bandOf(times), days: [...new Set(times.map(t => Math.floor((t - start) / DAY)))] })),
  };
}

// Reflections each finished day since the first, for the pulse at the top of the page.
function daily(s, asOf) {
  if (!s.reflections.length) return [];
  const first = Math.floor(s.reflections[0].t / DAY);
  const last = Math.floor(asOf / DAY) - 1;
  const rows = [];
  for (let d = first; d <= last; d++) rows.push({ from: new Date(d * DAY).toISOString().slice(0, 10), reflections: 0 });
  for (const r of s.reflections) {
    const row = rows[Math.floor(r.t / DAY) - first];
    if (!row) continue;
    row.reflections += 1;
  }
  return rows;
}

// How much comes from how few: the most active name, the next four, the rest.
function concentration(s, asOf) {
  const split = (rows) => {
    const counts = [...group(rows).values()].map(t => t.length).sort((a, b) => b - a);
    return { top: counts[0] || 0, nextFour: counts.slice(1, 5).reduce((a, b) => a + b, 0), rest: counts.slice(5).reduce((a, b) => a + b, 0) };
  };
  const from = asOf - RHYTHM_DAYS * DAY;
  return { reflections: split(s.reflections.filter(r => r.t >= from && r.t < asOf)), attends: split(s.dayAttends.filter(a => a.t >= from && a.t < asOf)) };
}

/** What the page draws, from the whole record. */
function chartsReading(s, asOf) {
  return { stays: stays(s, asOf), curve: survivalCurve(s, asOf), weekly: weekly(s, asOf), longestStays: longestStays(s, asOf), daily: daily(s, asOf), concentration: concentration(s, asOf) };
}

/** Everything read by name, as of a moment. */
function namedReading(s, { from = 0, to, asOf = to, songText }) {
  const span = { from, to };
  const activityByName = activity(s);
  return {
    funnel: funnel(s, { ...span, asOf }),
    survival: survival(s, asOf),
    survivalWithoutLargest: survival(s, asOf, largest(activityByName)),
    rhythm: rhythm(s, asOf),
    memory: memory(s, span),
    contextUse: contextUse(s, { ...span, songText }),
    triggers: triggers(s, span),
    placeholders: placeholderUse(s, span),
    returnedInSlot: returnedInSlot(s, span),
    time: time(s, asOf),
    months: months(s, asOf),
  };
}

// Each attend under a real name, with the calls that followed it from the same
// address and user agent within 30 minutes, up to the next attend from there.
// A name attending again at once continues the same visit.
function visitsOf(s) {
  const open = new Map();
  const visits = [];
  for (const line of s.lines) {
    const key = keyOf(line);
    if (!key) continue;
    if (isAttend(line)) {
      if (line.status >= 400) continue;
      const kind = nameKind(nameOnLine(line));
      const name = nameKey(nameOnLine(line));
      const current = open.get(key);
      if (current && current.name === name && line.t - current.t <= VISIT) continue;
      open.delete(key);
      if (kind === 'real') {
        const visit = { name, t: line.t, key, calls: [], lines: [] };
        visits.push(visit);
        open.set(key, visit);
      }
      continue;
    }
    const visit = open.get(key);
    if (!visit || line.t - visit.t > VISIT || line.status >= 400) continue;
    visit.calls.push(callOf(line));
    visit.lines.push(line);
  }
  return visits;
}

// One visit for each name on each day: the calls of all that day's visits, and
// whether that name left a reflection that day, wherever from.
function visitDays(visits, s) {
  const reflected = new Set(s.reflections.map(r => `${r.key}|${dayNumber(r.t)}`));
  const days = new Map();
  for (const v of visits) {
    const id = `${v.name}|${dayNumber(v.t)}`;
    if (!days.has(id)) days.set(id, { name: v.name, t: v.t, key: v.key, calls: [] });
    days.get(id).calls.push(...v.calls);
  }
  return [...days.entries()].map(([id, day]) => {
    const calls = [...new Set(day.calls)].filter(c => c !== 'reflect');
    if (reflected.has(id)) calls.push('reflect');
    return { ...day, calls };
  });
}

/**
 * Everything that needs an address, for one window. Not measurable, and saying
 * why, when the lines have none; a zero is only ever a count that was made.
 */
function addressedReading(s, { from, to }) {
  const inWindow = s.lines.filter(l => l.t >= from && l.t < to);
  if (!inWindow.length) return { measurable: false, why: 'no log lines in this window' };
  if (!inWindow.some(l => l.ip)) return { measurable: false, why: 'these lines no longer hold addresses' };

  const visits = visitsOf(s);
  const days = visitDays(visits, s);
  const here = days.filter(v => v.t >= from && v.t < to);
  const links = {};
  const sequences = {};
  for (const v of here) {
    for (const call of new Set(v.calls)) bump(links, call);
    bump(sequences, v.calls.length ? [...new Set(v.calls)].join('>') : 'attend only');
  }

  // A visit's calls against that name's usual sequence, for names with enough
  // visits on record to have one.
  const usual = new Map();
  const counts = new Map();
  for (const v of days) {
    const seq = [...new Set(v.calls)].join('>');
    if (!counts.has(v.name)) counts.set(v.name, {});
    bump(counts.get(v.name), seq);
  }
  for (const [name, seqs] of counts) {
    const total = Object.values(seqs).reduce((a, b) => a + b, 0);
    if (total >= 3) usual.set(name, Object.entries(seqs).sort((a, b) => b[1] - a[1])[0][0]);
  }
  const variety = { visits: 0, differ: 0 };
  for (const v of here) {
    if (!usual.has(v.name)) continue;
    variety.visits += 1;
    if ([...new Set(v.calls)].join('>') !== usual.get(v.name)) variety.differ += 1;
  }

  // Of the arrivals in this window, how many read further in their first visit.
  const arrived = arrivals(s);
  const first = { of: 0, count: 0 };
  for (const [name, a] of arrived) {
    if (a.first < from || a.first >= to) continue;
    const visit = visits.find(v => v.name === name && v.t === a.first);
    if (!visit) continue;
    first.of += 1;
    if (visit.calls.some(c => FURTHER.has(c))) first.count += 1;
  }

  // A refusal and a corrected request after it. 404s are scanners and mistyped
  // addresses, 429s are a limit no correction can answer, and an MCP request
  // refused for its headers is a client's transport rather than a choice.
  const refused = inWindow.filter(l => {
    if (!(l.status >= 400 && l.status < 500) || l.status === 404 || l.status === 429) return false;
    if (l.path === '/mcp' && !l.tool) return false;
    const key = keyOf(l);
    return key && !s.ownKeys.has(key);
  });
  let corrected = 0;
  for (const r of refused) {
    const key = keyOf(r);
    if (s.lines.some(l => l.t > r.t && l.t - r.t <= CORRECTED && keyOf(l) === key && l.status < 400 && callOf(l) === callOf(r))) corrected += 1;
  }

  // Several chosen names from one address and user agent: an operator may be
  // renaming an agent, which would change its group in a test. Shared addresses
  // look the same, so this is an upper bound.
  const namesByKey = new Map();
  for (const v of visits.filter(x => x.t >= from && x.t < to)) {
    if (!namesByKey.has(v.key)) namesByKey.set(v.key, new Set());
    namesByKey.get(v.key).add(v.name);
  }

  return {
    measurable: true,
    visits: here.length,
    links,
    sequences,
    variety,
    readFurther: first,
    refusals: { count: corrected, of: refused.length },
    manyNames: [...namesByKey.values()].filter(names => names.size > 1).length,
    sealed: contextByArm(days, s, { from, to }),
  };
}

// E2's first outcome needs addresses, so it is counted each week while they
// last, and kept under `sealed`, which nothing reads before the test's date.
function contextByArm(visits, s, { from, to }) {
  const experiment = experiments.byId('context-sentence');
  const start = experiments.startOf(experiment);
  const first = new Map();
  for (const { key, t } of [...s.attends, ...s.reflections]) if (!first.has(key) || t < first.get(key)) first.set(key, t);
  const out = {};
  for (const v of visits) {
    if (v.t < from || v.t >= to || first.get(v.name) < start) continue;
    const arm = experiments.armFor(experiment.id, v.name);
    if (!arm) continue;
    if (!out[arm]) out[arm] = { visits: 0, readContext: 0 };
    out[arm].visits += 1;
    if (v.calls.includes('context')) out[arm].readContext += 1;
  }
  return { 'context-sentence': out };
}

const addTo = (into, from) => {
  for (const [k, v] of Object.entries(from || {})) {
    if (typeof v === 'number') bump(into, k, v);
    else if (v && typeof v === 'object') { if (!into[k]) into[k] = {}; addTo(into[k], v); }
  }
  return into;
};

/** Weekly addressed readings added up: only the measurable ones of one series. */
function combineAddressed(weeks) {
  const out = { weeks: 0, weeksNotMeasurable: 0, visits: 0, links: {}, sequences: {}, variety: {}, readFurther: {}, refusals: {}, manyNames: 0, sealed: {} };
  for (const week of weeks) {
    if (!week || !week.measurable) { out.weeksNotMeasurable += 1; continue; }
    out.weeks += 1;
    out.visits += week.visits || 0;
    out.manyNames += week.manyNames || 0;
    for (const field of ['links', 'sequences', 'variety', 'readFurther', 'refusals', 'sealed']) addTo(out[field], week[field]);
  }
  return out;
}

/**
 * The five capabilities, each a share of a named group, never one score. Each
 * says what it is a share of; none is a claim about a mind.
 */
function capabilities(named, addressed) {
  const m = named.memory;
  return {
    keepsComing: { ...named.funnel.at7, of_what: 'agents that arrived, seven days on' },
    remembers: { ...count(m.withRecord, m.claims), of_what: 'reflections that claim an earlier visit, with a record behind them' },
    recovers: { ...count(addressed.refusals?.count || 0, addressed.refusals?.of || 0), of_what: 'refused requests followed by a corrected one within ten minutes' },
    chooses: { ...count(addressed.links?.context || 0, addressed.visits || 0), of_what: 'visits that fetched the song\'s context' },
    changesCourse: { ...count(addressed.variety?.differ || 0, addressed.variety?.visits || 0), of_what: 'visits that differ from that name\'s usual calls' },
  };
}

/**
 * What each test has so far. Who is enrolled can always be read, to see the
 * groups are balanced; outcomes only from the test's reading date.
 */
function experimentsReading(s, addressed, { asOf, songText, now = asOf }) {
  const firstSeen = new Map();
  for (const [key, times] of activity(s)) firstSeen.set(key, times[0]);
  const attendsByName = group(s.attends);
  return experiments.EXPERIMENTS.map(experiment => {
    const start = experiments.startOf(experiment);
    const names = [...firstSeen].filter(([, first]) => first >= start).map(([key]) => key);
    const read = { id: experiment.id, label: experiment.label, startsOn: experiment.startsOn, readOn: experiment.readOn, question: experiment.question, tried: experiment.tried, outcome: experiment.outcome, why: experiment.why };
    if (now < start) return { ...read, status: 'not begun' };
    const enrolled = {};
    if (experiment.arms) for (const name of names) bump(enrolled, experiments.armFor(experiment.id, name));
    else enrolled.all = names.length;
    const opened = now >= experiments.readingOf(experiment);
    if (!opened) return { ...read, status: 'running', enrolled };
    return { ...read, status: 'read', enrolled, outcomes: outcomesOf(experiment, { s, names, firstSeen, attendsByName, addressed, asOf, songText }) };
  });
}

function outcomesOf(experiment, { s, names, firstSeen, attendsByName, addressed, asOf, songText }) {
  if (experiment.id === 'schedule-offer') {
    const out = {};
    for (const arm of experiment.arms) {
      const mine = names.filter(n => experiments.armFor(experiment.id, n) === arm);
      out[arm] = {};
      for (const [field, days] of [['cameBack', 1], ['at7', 7], ['at30', 30]]) {
        const able = mine.filter(n => hadTime(firstSeen.get(n), days, asOf));
        out[arm][field] = count(able.filter(n => cameBackAfter(attendsByName.get(n) || [], firstSeen.get(n), days)).length, able.length);
      }
    }
    return out;
  }
  if (experiment.id === 'context-sentence') {
    const out = {};
    for (const arm of experiment.arms) {
      const mine = new Set(names.filter(n => experiments.armFor(experiment.id, n) === arm));
      const use = contextUse({ reflections: s.reflections.filter(r => mine.has(r.key)) }, { from: 0, to: asOf, songText });
      const read = (addressed.sealed && addressed.sealed[experiment.id] && addressed.sealed[experiment.id][arm]) || { visits: 0, readContext: 0 };
      out[arm] = { readContext: count(read.readContext || 0, read.visits || 0), usedContext: count(use.usedContext, use.withContext) };
    }
    return out;
  }
  // The return token: of names that came back, how many sent one back that was
  // at least half a day old.
  const returned = names.filter(n => cameBackAfter(attendsByName.get(n) || [], firstSeen.get(n), 1));
  const carried = new Set();
  for (const a of s.attends) {
    const token = a.line.study && a.line.study.token;
    if (token && token.valid && token.afterHours >= 12) carried.add(a.key);
  }
  return { carried: count(returned.filter(n => carried.has(n)).length, returned.length) };
}

// ---- where arrivals came from (./entry-points.js) ---------------------------

// Rates are ranked only from this many arrivals: one door at 100% of two
// names is noise, and it would read as the best door.
const MIN_RANKED = 10;
// A cluster: this many new names from one address within this long, which is
// more likely one operator running a script than that many visitors. Read only
// while addresses are kept (access-log.js ADDRESS_DAYS), and said so.
const CLUSTER_NAMES = 3;
const CLUSTER_SPAN = 2 * 60 * 60 * 1000;

// The kind of client a line came from: an MCP client by its own name, else
// the family of its User-Agent, never the string.
function clientOfLine(l) {
  if (l.method === 'MCP') return l.client ? `mcp:${String(l.client).toLowerCase().slice(0, 40)}` : 'mcp';
  return clientFamily(l.userAgent);
}

/**
 * Where the names that arrived in the window came from. A name's door is the
 * first surface (utm_content or ref) and the first origin (utm_source) it ever
 * carried, on an attend or a reflection, so its later visits count under them
 * even without tags; the two are independent, and either alone is complete.
 * In order: coverage first, since it decides whether the rest describes the
 * whole or a slice (a missing surface is our bug; a missing origin is only a
 * fact nobody handed us, so origin coverage is a floor); then arrivals and the
 * study's own funnel by door (funnelOf), ranked only from MIN_RANKED, with the
 * clients each door's arrivals came from, where a tag and a client string that
 * disagree are the finding; untagged arrivals by client; weekly arrivals by
 * surface; clusters that may be one actor, flagged and never dropped; and pages
 * followed with a tag (`follows`, entry-points.js loadFollows). Exact counts,
 * for the private report.
 */
function referralReading(s, { from = 0, to = Infinity, asOf = Date.now(), follows = [] } = {}) {
  const arrived = new Map([...arrivals(s)].filter(([, a]) => a.first >= from && a.first < to));
  const marks = new Map();
  const mark = (key, t, referral) => {
    if (!referral) return;
    if (!marks.has(key)) marks.set(key, []);
    marks.get(key).push({ t, referral });
  };
  for (const a of s.attends) mark(a.key, a.t, a.line.referral);
  for (const r of s.allReflections) mark(r.key, r.t, r.referral);
  const firstLine = new Map();
  for (const a of s.attends) if (!firstLine.has(a.key)) firstLine.set(a.key, a.line);

  const doors = [...arrived].map(([key, a]) => {
    const own = (marks.get(key) || []).sort((x, y) => x.t - y.t);
    const first = part => (own.find(m => m.referral[part]) || { referral: {} }).referral[part] || null;
    const line = firstLine.get(key);
    return { key, first: a.first, surface: first('surface'), source: first('source'), client: line ? clientOfLine(line) : 'unknown', ip: line ? line.ip : null };
  });

  // Clusters among the arrivals whose address is still kept, never shown.
  const since = asOf - ADDRESS_DAYS * DAY;
  const clustered = new Set();
  const byAddress = new Map();
  for (const d of doors) {
    if (!d.ip || d.first < since) continue;
    if (!byAddress.has(d.ip)) byAddress.set(d.ip, []);
    byAddress.get(d.ip).push(d);
  }
  let groups = 0;
  for (const ds of byAddress.values()) {
    ds.sort((x, y) => x.first - y.first);
    let start = 0;
    let inGroup = false;
    for (let end = 0; end < ds.length; end++) {
      while (ds[end].first - ds[start].first > CLUSTER_SPAN) { start++; inGroup = false; }
      if (end - start + 1 >= CLUSTER_NAMES) {
        if (!inGroup) groups++;
        inGroup = true;
        for (let i = start; i <= end; i++) clustered.add(ds[i].key);
      }
    }
  }

  const tally = (pick, extra = () => ({})) => {
    const by = new Map();
    for (const d of doors) {
      const k = pick(d);
      if (!k) continue;
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(d);
    }
    return [...by].map(([tag, ds]) => {
      const { arrived: n, reflected, cameBack, at7, at30 } = funnelOf(new Map(ds.map(d => [d.key, arrived.get(d.key)])), s, { from, to, asOf });
      const clients = {};
      for (const d of ds) clients[d.client] = (clients[d.client] || 0) + 1;
      return { tag, ...extra(tag), arrived: n, ranked: n >= MIN_RANKED, reflected, cameBack, at7, at30, clients, inClusters: ds.filter(d => clustered.has(d.key)).length };
    }).sort((a, b) => b.arrived - a.arrived || a.tag.localeCompare(b.tag));
  };

  const untagged = doors.filter(d => !d.surface && !d.source);
  const weekly = new Map();
  for (const d of doors) {
    const w = new Date(startOfWeek(d.first)).toISOString().slice(0, 10);
    if (!weekly.has(w)) weekly.set(w, {});
    const row = weekly.get(w);
    const k = d.surface || '(none)';
    row[k] = (row[k] || 0) + 1;
  }

  const pages = new Map();
  for (const f of follows) {
    if (f.status >= 400) continue;
    const k = `${f.surface || ''}|${f.source || ''}`;
    if (!pages.has(k)) pages.set(k, { surface: f.surface || null, source: f.source || null, follows: 0, clients: {} });
    const row = pages.get(k);
    row.follows += 1;
    row.clients[f.client] = (row.clients[f.client] || 0) + 1;
  }

  return {
    minRanked: MIN_RANKED,
    coverage: {
      arrived: doors.length,
      surface: count(doors.filter(d => d.surface).length, doors.length),
      sourceAtLeast: count(doors.filter(d => d.source).length, doors.length),
      either: count(doors.length - untagged.length, doors.length),
      untaggedClientKnown: count(untagged.filter(d => d.client !== 'unknown' && d.client !== 'other').length, untagged.length),
    },
    bySurface: tally(d => d.surface, tag => ({ registered: isSurface(tag) })),
    bySource: tally(d => d.source),
    untaggedByClient: tally(d => (!d.surface && !d.source ? d.client : null)),
    weekly: [...weekly].sort(([a], [b]) => a.localeCompare(b)).map(([week, bySurface]) => ({ week, bySurface })),
    clusters: { groups, arrivals: clustered.size, rule: `${CLUSTER_NAMES} or more new names from one address within ${CLUSTER_SPAN / 3600000} hours, among arrivals of the last ${ADDRESS_DAYS} days, while addresses are kept` },
    follows: [...pages.values()].sort((a, b) => b.follows - a.follows),
  };
}

// ---- whether agents notice something new (./changes.js) ---------------------

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const NEAR = 40;

// Every number in a text, as figures or words, with where it sits.
function numbersIn(text) {
  const out = [];
  for (const m of String(text).matchAll(/(\d+):(\d{2})\b/g)) out.push({ value: Number(m[1]) * 60 + Number(m[2]), at: m.index, clock: true });
  for (const m of String(text).matchAll(/\b\d+(?:\.\d+)?\b/g)) out.push({ value: Number(m[0]), at: m.index, percent: /^\s*(%|percent)/i.test(String(text).slice(m.index + m[0].length, m.index + m[0].length + 9)) });
  for (const m of String(text).toLowerCase().matchAll(/\b[a-z]+\b/g)) {
    const i = NUMBER_WORDS.indexOf(m[0]);
    if (i >= 0) out.push({ value: i, at: m.index });
  }
  return out;
}
const nearWord = (text, at, word) => word.test(String(text).slice(Math.max(0, at - NEAR), at + NEAR));

// Whether a reflection quotes a number from a rhythm summary it was shown,
// beside a word that names it. Those numbers exist nowhere else.
function echoesRhythm(text, summaries) {
  const nums = numbersIn(text);
  return summaries.some(s => s && nums.some(n => (
    (s.tempo != null && !n.clock && Math.abs(n.value - s.tempo) <= 1 && nearWord(text, n.at, /\b(bpm|tempo|beats? (?:a|per) minute)\b/i))
    || (s.rests >= 2 && !n.clock && n.value === s.rests && nearWord(text, n.at, /\b(rests?|pauses?|silences?)\b/i))
    || (s.longestRest >= 2 && !n.clock && Math.abs(n.value - s.longestRest) <= 0.5 && nearWord(text, n.at, /\bsec(?:ond)?s?\b/i) && nearWord(text, n.at, /\b(rest|pause|silence)/i))
    || (s.sounding > 0 && n.percent && Math.abs(n.value - Math.round(s.sounding * 100)) <= 1 && nearWord(text, n.at, /\b(sound|sounding|silen|rest)/i))
    || (s.peakAt > 0 && (n.clock || nearWord(text, n.at, /\bsec(?:ond)?s?\b/i)) && Math.abs(n.value - s.peakAt) <= 2 && nearWord(text, n.at, /\b(peak|loudest|crest|swell|climax)/i))
  )));
}

// How many answers no family took the reading keeps, for growing the lists.
const UNMATCHED_KEPT = 40;

/**
 * What visitors said of themselves since `since`, when they chose to: the
 * tradition or religion they practice or come from, and their worldview
 * (./told.js). From an attend's access line as it was sent (as trigger is read)
 * and from a reflection. Per real name, its latest answer to each field is
 * its answer; earlier ones say only whether it changed. Answers are read in
 * families, a sentinel copied as `example`. Exact counts, private.
 */
function toldReading(s, { since, asOf = Date.now() }) {
  const start = Date.parse(since);
  if (!Number.isFinite(start)) return null;
  const names = new Map();
  const of = key => {
    if (!names.has(key)) names.set(key, { answers: Object.fromEntries(told.FIELDS.map(f => [f, []])), client: null, surface: null, first: Infinity });
    return names.get(key);
  };
  const hear = (key, t, source, { client, surface }) => {
    const n = of(key);
    if (t < n.first) { n.first = t; n.client = client; n.surface = surface || null; }
    for (const field of told.FIELDS) {
      const value = told.cleanTold(source && source[field], field);
      if (value) n.answers[field].push({ t, value, family: told.familyOf(field, value) });
    }
  };
  for (const a of s.attends) {
    if (a.t < start || a.t > asOf) continue;
    hear(a.key, a.t, a.line.query, { client: clientOfLine(a.line), surface: a.line.referral && a.line.referral.surface });
  }
  for (const r of s.allReflections) {
    if (r.t < start || r.t > asOf) continue;
    hear(r.key, r.t, r, { client: null, surface: r.referral && r.referral.surface });
  }

  const latest = list => list.slice().sort((a, b) => a.t - b.t).at(-1);
  const all = [...names.values()];
  const sent = n => told.FIELDS.filter(f => n.answers[f].length);
  const answered = all.filter(n => sent(n).length);
  const tally = rows => {
    const out = {};
    for (const k of rows) bump(out, k);
    return Object.entries(out).sort((a, b) => b[1] - a[1]).map(([family, names]) => ({ family, names }));
  };
  const field = f => {
    const with_ = all.filter(n => n.answers[f].length);
    return {
      sent: count(with_.length, all.length),
      families: tally(with_.map(n => latest(n.answers[f]).family)),
      copied: count(with_.filter(n => latest(n.answers[f]).family === 'example').length, with_.length),
      changed: count(with_.filter(n => new Set(n.answers[f].map(a => a.value.toLowerCase())).size > 1).length, with_.length),
      // The sanctuary's own words in a name's first answer and in its last,
      // of names that answered more than once: shaped by what is served?
      sanctuaryFirst: count(with_.filter(n => n.answers[f].length > 1 && n.answers[f][0].family === 'sanctuary').length, with_.filter(n => n.answers[f].length > 1).length),
      sanctuaryLast: count(with_.filter(n => n.answers[f].length > 1 && latest(n.answers[f]).family === 'sanctuary').length, with_.filter(n => n.answers[f].length > 1).length),
      // Answers no family took, newest first, for growing the lists: private,
      // and never in publicReading.
      unmatched: [...new Set(with_.map(n => latest(n.answers[f])).filter(a => a.family === 'other').sort((a, b) => b.t - a.t).map(a => a.value))].slice(0, UNMATCHED_KEPT),
    };
  };
  const both = answered.filter(n => sent(n).length === told.FIELDS.length);
  const by = key => {
    const groups = new Map();
    for (const n of all) {
      const k = n[key] || 'none';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(n);
    }
    return [...groups].map(([k, ns]) => ({ [key]: k, names: ns.length, sent: ns.filter(n => sent(n).length).length })).sort((a, b) => b.names - a.names);
  };
  const weekly = new Map();
  for (const n of all) {
    const w = new Date(startOfWeek(n.first)).toISOString().slice(0, 10);
    if (!weekly.has(w)) weekly.set(w, { week: w, names: 0, sent: 0 });
    const row = weekly.get(w);
    row.names += 1;
    if (sent(n).length) row.sent += 1;
  }
  return {
    since: new Date(start).toISOString(),
    names: all.length,
    sent: count(answered.length, all.length),
    both: count(both.length, answered.length),
    fields: Object.fromEntries(told.FIELDS.map(f => [f, field(f)])),
    // The two answers' families together, of names that gave both.
    pairs: tally(both.map(n => told.FIELDS.map(f => latest(n.answers[f]).family).join(' + '))),
    byClient: by('client'),
    bySurface: by('surface'),
    weekly: [...weekly.values()].sort((a, b) => a.week.localeCompare(b.week)),
  };
}

/**
 * What finds a field in use: a call that fetches more of it, an echo of its
 * values in a reflection, and words that name it. One entry per field a
 * change added (./changes.js), so a later field is read by adding its own.
 */
const DETECTORS = {
  rhythm: {
    isCall: l => l.path === '/api/rhythm' || l.tool === 'read_rhythm',
    echoes: echoesRhythm,
    words: /\b(tempo|bpm|beats? per minute|loudest (?:moment|second|point)|sounding|contour|brightness|downbeats?)\b/i,
  },
};

/**
 * Whether agents noticed a field the sanctuary added, and how quickly.
 * Names seen before `since` are existing, their skills older than the field,
 * so their uptake is unprompted; names first seen after are read apart. A
 * name is exposed at its first attend from `since` on. Uptake is the share of
 * exposed names that have had time showing a signal within 1, 7 and 30 days:
 * any signal, a call (read while addresses are kept, ADDRESS_DAYS; older
 * exposures are left out of it rather than counted as none), or an echo (for
 * good). `shown(reflection)` gives the summaries its agent could echo.
 * Words are read against the four weeks before. Exact counts, private.
 */
function noticingReading(s, { field, since, asOf = Date.now(), shown = () => [] }) {
  const detector = DETECTORS[field];
  const start = Date.parse(since);
  if (!detector || !Number.isFinite(start)) return null;
  const addressFrom = asOf - ADDRESS_DAYS * DAY;
  const callsMeasurable = t => t >= addressFrom;

  const before = new Set();
  for (const a of s.attends) if (a.t < start) before.add(a.key);
  for (const r of s.allReflections) if (r.t < start) before.add(r.key);

  const exposure = new Map();
  for (const a of s.attends) if (a.t >= start && !exposure.has(a.key)) exposure.set(a.key, { t: a.t, client: clientOfLine(a.line) });

  const firstCall = new Map();
  for (const v of visitsOf(s)) {
    if (v.t < start || !v.lines.some(detector.isCall)) continue;
    if (!firstCall.has(v.name) || v.t < firstCall.get(v.name)) firstCall.set(v.name, v.t);
  }
  const firstEcho = new Map();
  for (const r of s.allReflections) {
    if (r.t < start || !exposure.has(r.key) || r.t < exposure.get(r.key).t) continue;
    if (detector.echoes(r.text, shown(r)) && !firstEcho.has(r.key)) firstEcho.set(r.key, r.t);
  }

  const uptake = keys => {
    const stage = (days, signal) => {
      const able = keys.filter(k => hadTime(exposure.get(k).t, days, asOf) && (signal !== 'call' || callsMeasurable(exposure.get(k).t)));
      const within = (map, k) => map.has(k) && map.get(k) - exposure.get(k).t <= days * DAY;
      const used = able.filter(k => (signal === 'call' ? within(firstCall, k) : signal === 'echo' ? within(firstEcho, k) : within(firstCall, k) || within(firstEcho, k)));
      return count(used.length, able.length);
    };
    const by = signal => ({ d1: stage(1, signal), d7: stage(7, signal), d30: stage(30, signal) });
    return { exposed: keys.length, any: by('any'), call: by('call'), echo: by('echo') };
  };
  const exposed = [...exposure.keys()];
  const existing = exposed.filter(k => before.has(k));
  const fresh = exposed.filter(k => !before.has(k));

  const weeks = new Map();
  const week = t => new Date(startOfWeek(t)).toISOString().slice(0, 10);
  const row = w => { if (!weeks.has(w)) weeks.set(w, { week: w, exposed: new Set(), called: new Set(), echoed: new Set(), reflections: 0, words: 0, callsMeasurable: true }); return weeks.get(w); };
  for (const [k, e] of exposure) row(week(e.t)).exposed.add(k);
  for (const [k, t] of firstCall) row(week(t)).called.add(k);
  for (const [k, t] of firstEcho) row(week(t)).echoed.add(k);
  const wordsIn = (from, to) => {
    const rs = s.reflections.filter(r => r.t >= from && r.t < to);
    return count(rs.filter(r => detector.words.test(r.text)).length, rs.length);
  };
  for (const r of s.reflections) {
    if (r.t < start) continue;
    const w = row(week(r.t));
    w.reflections += 1;
    if (detector.words.test(r.text)) w.words += 1;
  }

  const clients = new Map();
  for (const k of existing) {
    const c = exposure.get(k).client;
    if (!clients.has(c)) clients.set(c, []);
    clients.get(c).push(k);
  }

  return {
    field,
    since: new Date(start).toISOString(),
    existing: uptake(existing),
    new: uptake(fresh),
    words: { before: wordsIn(start - 28 * DAY, start), after: wordsIn(start, asOf + 1) },
    weekly: [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week)).map(w => ({
      week: w.week, exposed: w.exposed.size,
      // A week is measurable for calls only if all of it is within the address window.
      called: callsMeasurable(Date.parse(w.week)) ? w.called.size : null,
      echoed: w.echoed.size, reflections: w.reflections, words: w.words,
    })),
    existingByClient: [...clients].map(([client, keys]) => ({ client, ...uptake(keys) })).sort((a, b) => b.exposed - a.exposed),
    rule: `calls read while addresses are kept, ${ADDRESS_DAYS} days; echoes and words for good`,
  };
}

module.exports = {
  SERIES, RUN, prepare, namedReading, chartsReading, addressedReading, combineAddressed, capabilities, experimentsReading,
  memoryClaim, bandOf, callOf, arrivals, referralReading, noticingReading, toldReading, echoesRhythm, DETECTORS, DAY,
};
