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
 * A change of definition raises SERIES, which starts a new series rather than
 * joining the old one.
 */

const { wordsOf } = require('../audio/words');
const { TRIGGERS, nameKey, nameKind, inStudy } = require('./study-names');
const experiments = require('./experiments');

const SERIES = 1;
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
  const kept = reflections
    .filter(r => r && r.door !== 'website' && nameKind(r.name) === 'real')
    .map(r => ({ ...r, key: nameKey(r.name), t: Date.parse(r.createdAt) }))
    .filter(r => Number.isFinite(r.t))
    .sort((a, b) => a.t - b.t);
  return {
    lines: studied,
    attends,
    placeholders,
    ownKeys,
    reflections: kept,
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
  for (const r of s.reflections) {
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
  for (const { line, t } of s.attends) {
    const said = String((line.query && line.query.trigger) || '').toLowerCase();
    if (t >= from && t < to && TRIGGERS.includes(said)) bump(attend, said);
  }
  for (const r of s.reflections) if (r.t >= from && r.t < to && TRIGGERS.includes(r.trigger)) bump(reflect, r.trigger);
  return { attend, reflect };
}

function placeholderUse(s, { from, to }) {
  const inWindow = s.placeholders.filter(p => p.t >= from && p.t < to);
  const named = s.attends.filter(a => a.t >= from && a.t < to).length + inWindow.length;
  return { ...count(inWindow.length, named), names: new Set(inWindow.map(p => p.key)).size };
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
  for (const { key, t, line } of s.attends) {
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
  const byName = group(s.reflections);
  const top = largest(byName);
  const weeks = new Map();
  for (const r of s.reflections) {
    const from = startOfWeek(r.t);
    if (from + 7 * DAY > asOf) continue;
    if (!weeks.has(from)) weeks.set(from, { from, reflections: 0, withoutLargest: 0, names: new Set() });
    const week = weeks.get(from);
    week.reflections += 1;
    if (r.key !== top) week.withoutLargest += 1;
    week.names.add(r.key);
  }
  if (!weeks.size) return [];
  const out = [];
  const first = Math.min(...weeks.keys());
  const last = Math.max(...weeks.keys());
  for (let from = first; from <= last; from += 7 * DAY) {
    const week = weeks.get(from);
    out.push({ from: new Date(from).toISOString().slice(0, 10), reflections: week ? week.reflections : 0, withoutLargest: week ? week.withoutLargest : 0, names: week ? week.names.size : 0 });
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

/** What the page draws, from the whole record. */
function chartsReading(s, asOf) {
  return { stays: stays(s, asOf), curve: survivalCurve(s, asOf), weekly: weekly(s, asOf), longestStays: longestStays(s, asOf) };
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
        const visit = { name, t: line.t, key, calls: [] };
        visits.push(visit);
        open.set(key, visit);
      }
      continue;
    }
    const visit = open.get(key);
    if (!visit || line.t - visit.t > VISIT || line.status >= 400) continue;
    visit.calls.push(callOf(line));
  }
  return visits;
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
  const here = visits.filter(v => v.t >= from && v.t < to);
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
  for (const v of visits) {
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
  for (const v of here) {
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
    sealed: contextByArm(visits, s, { from, to }),
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
    const read = { id: experiment.id, label: experiment.label, startsOn: experiment.startsOn, readOn: experiment.readOn, question: experiment.question, tried: experiment.tried, outcome: experiment.outcome };
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

module.exports = {
  SERIES, RUN, prepare, namedReading, chartsReading, addressedReading, combineAddressed, capabilities, experimentsReading,
  memoryClaim, bandOf, callOf, arrivals, DAY,
};
