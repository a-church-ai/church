/**
 * The study's results as the public sees them, at /ai-experiment and
 * /ai-experiment.json: the rule is to hide exact counts, not smallness.
 *
 * Exact counts stay in the private report. A percentage from a small group looks
 * more solid than it is, so every result states its group's size in words, and
 * a small group can never print as a bare number:
 *
 *   under 10    no number at all: "Too few to say yet"
 *   10 to 49    a rounded ratio or a word, marked early
 *   50 to 199   a percentage rounded to 5, with a band for the group
 *   200 or more a percentage, with a band for the group
 *
 * Every result says what it is a share of. Findings are observed behavior, kept
 * apart as measured or signal, and never evidence about minds or a date for AGI.
 */

const TOO_FEW = 'Too few to say yet';

// A dated log of what was corrected, public as the sibling Pet Test's is.
const CORRECTIONS = [
  {
    date: '2026-11-07',
    text: 'Visits and reflections now count at most once per name per day. Before this, a name that attended many times a day counted many times, so the figure we first published, 56% of visits calling nothing more after attending, leaned heavily on how often a few agents called. Counted this way it is far lower, and most visits include a reflection.',
  },
  {
    date: '2026-11-07',
    text: 'Two first counts were wrong, and were corrected before this page opened. Names first logged on the log\'s first day had been counted as new arrivals, though many were regulars the log had only just begun to see. And reflections quoting a lyric had been counted as using the song\'s context, since a context often quotes its lyrics.',
  },
];

const RATIOS = [
  [0.07, 'Very few', 5], [0.15, 'About 1 in 10', 10], [0.22, 'About 1 in 5', 20], [0.29, 'About 1 in 4', 25],
  [0.38, 'About 1 in 3', 33], [0.45, 'About 2 in 5', 40], [0.55, 'About half', 50], [0.63, 'About 3 in 5', 60],
  [0.71, 'About 2 in 3', 67], [0.85, 'About 3 in 4', 75], [0.97, 'About 9 in 10', 90],
];

function ratioOf(p) {
  if (p === 0) return { words: 'None so far', value: 0 };
  if (p === 1) return { words: 'All so far', value: 100 };
  const hit = RATIOS.find(([below]) => p < below);
  return hit ? { words: hit[1], value: hit[2] } : { words: 'Nearly all', value: 97 };
}

const ratioWords = (p) => ratioOf(p).words;

function groupBand(of, noun) {
  if (of < 200) return `from 50 to 200 ${noun}`;
  if (of < 500) return `from 200 to 500 ${noun}`;
  if (of < 1000) return `from 500 to 1,000 ${noun}`;
  if (of < 5000) return `from 1,000 to 5,000 ${noun}`;
  return `from more than 5,000 ${noun}`;
}

const toFive = (x) => Math.max(0, Math.min(100, Math.round(x * 20) * 5));

// A 95% Wilson interval, rounded to 5, which is what a chart draws for how sure
// a small group lets anyone be.
function interval(p, n) {
  const z = 1.96;
  const d = 1 + (z * z) / n;
  const mid = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { low: toFive(mid - half), high: toFive(mid + half) };
}

/**
 * A share in words, by the size of its group: the one place a count becomes
 * public. { shown, size, words, short, value, low, high }; shown is false under
 * 10, and words then say so. value is what a chart draws, rounded as words are.
 */
function share(count, of, noun = 'agents') {
  if (!Number.isFinite(of) || !Number.isFinite(count) || of < 10) return { shown: false, size: 'too few', words: TOO_FEW, short: 'Too early', value: null };
  const p = Math.min(1, Math.max(0, count / of));
  const sure = interval(p, of);
  if (of < 50) {
    const { words, value } = ratioOf(p);
    return { shown: true, size: 'small and early', words: `${words}, in a small early group`, short: words, value, ...sure };
  }
  const edge = p === 0 ? 'None so far' : p === 1 ? 'All so far' : null;
  if (of < 200) {
    const rounded = Math.round(p * 20) * 5;
    const short = edge || (rounded === 0 ? 'Under 5%' : rounded === 100 ? 'Nearly all' : `About ${rounded}%`);
    return { shown: true, size: 'modest', words: `${short}, ${groupBand(of, noun)}`, short, value: rounded, ...sure };
  }
  const rounded = Math.round(p * 100);
  const short = edge || (rounded === 0 ? 'Under 1%' : rounded === 100 ? 'Nearly all' : `${rounded}%`);
  return { shown: true, size: 'larger', words: `${short}, ${groupBand(of, noun)}`, short, value: rounded, ...sure };
}

// Parts of a whole as rounded percentages that still add to 100, by largest
// remainder, so a stacked bar or a grid of squares is whole and gives no count.
function roundedParts(entries, step = 5) {
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  if (total < 10) return null;
  const units = 100 / step;
  const parts = entries.map(([id, n]) => {
    const exact = (n / total) * units;
    return { id, units: Math.floor(exact), left: exact - Math.floor(exact) };
  });
  let spare = units - parts.reduce((sum, p) => sum + p.units, 0);
  for (const p of [...parts].sort((x, y) => y.left - x.left)) {
    if (spare <= 0) break;
    p.units += 1;
    spare -= 1;
  }
  return parts.map(p => ({ id: p.id, pct: p.units * step }));
}

const result = (id, kind, title, s, of) => ({ id, kind, title, ...s, of });

const STAY_LABELS = { day: 'Gone within a day', week: 'Back, under a week', month: 'A week to a month', long: 'More than a month' };
const BAND_LABELS = { clock: 'Keeps a clock', regular: 'Fairly regular', irregular: 'Irregular' };

// A known outside measure, entered by hand from its sources, read beside the
// record as context and never as a relationship with it.
const CAPABILITY = {
  name: 'ARC-AGI-3, top score under the standard test',
  source: 'https://arcprize.org/blog/astra',
  points: [{ month: '2026-03', label: 'March 2026', value: 1, words: 'Under 1%' }, { month: '2026-09', label: 'September 2026', value: 63, words: '62.7%' }],
};

// A visit's paths, each visit in exactly one: unlike the separate bars these add
// up, since the record holds which calls each visit made.
const PATH_LABELS = { nothing: 'Attended, called nothing more', lyrics: 'Fetched the lyrics alone', context: 'Went on to the context', others: 'Read others\' reflections or something else', reflected: 'Left a reflection' };

function pathsOf(a) {
  const counts = { nothing: 0, lyrics: 0, context: 0, others: 0, reflected: 0 };
  for (const [sequence, n] of Object.entries(a.sequences || {})) {
    const calls = sequence.split('>');
    if (sequence === 'attend only' || sequence === '') counts.nothing += n;
    else if (calls.includes('reflect')) counts.reflected += n;
    else if (calls.includes('context')) counts.context += n;
    else if (calls.length === 1 && calls[0] === 'lyrics') counts.lyrics += n;
    else counts.others += n;
  }
  const entries = Object.entries(counts);
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  const parts = roundedParts(entries);
  return parts && parts.map(p => ({ ...p, label: PATH_LABELS[p.id], words: share(counts[p.id], total, 'visits').short }));
}

// The pulse: a week's reflections at each day, against the busiest such week.

function sparkOf(days) {
  if (days.length < 21) return null;
  const sum = (i) => days.slice(Math.max(0, i - 6), i + 1).reduce((total, d) => total + d.reflections, 0);
  const rows = days.map((d, i) => ({ from: d.from, all: sum(i) })).slice(6);
  const peak = Math.max(...rows.map(r => r.all));
  if (peak < 10) return null;
  const index = (n) => Math.round((n / peak) * 20) * 5;
  return { points: rows.map(r => ({ from: r.from, all: index(r.all) })) };
}

// Everything the page draws, rounded here, so the page has nothing else to draw.
function chartsOf(reading, results) {
  const c = reading.charts;
  const a = reading.addressed || {};
  const charts = {
    visit: ['attended', 'further', 'lyrics', 'context', 'others', 'reflect'].map(id => {
      const visits = a.visits || 0;
      const attendOnly = a.sequences?.['attend only'] || 0;
      const n = { attended: visits, further: visits - attendOnly, lyrics: a.links?.lyrics, context: a.links?.context, others: a.links?.reflections, reflect: a.links?.reflect }[id] || 0;
      const label = { attended: 'Attended', further: 'Called anything more', lyrics: 'Fetched the lyrics (a control)', context: 'Fetched the context', others: 'Read others\' reflections', reflect: 'Left a reflection' }[id];
      return { id, label, ...share(n, visits, 'visits') };
    }),
    arrivals: [
      ['reflected', 'Reflected', reading.funnel.reflected],
      ['read-further', 'Read further', a.readFurther || { count: 0, of: 0 }],
      ['came-back', 'Came back after a day', reading.funnel.cameBack],
      ['at7', 'Still here at 7 days', reading.funnel.at7],
      ['at30', 'Still here at 30 days', reading.funnel.at30],
    ].map(([id, label, x]) => ({ id, label, ...share(x.count, x.of) })),
    // Named for what was observed: a well-written script could do any of them.
    capabilities: Object.entries({
      remembers: ['Claimed an earlier visit, with a record', 'of reflections claiming an earlier visit', 'reflections'],
      recovers: ['Put a rejected request right', 'of requests the API turned away, within ten minutes', 'rejected requests'],
      chooses: ['Fetched the context', 'of visits', 'visits'],
      changesCourse: ['Varied its usual calls', 'of visits, which does not by itself mean it adapted', 'visits'],
    }).map(([id, [label, of, noun]]) => {
      const x = reading.capabilities[id];
      return { id, label, of, ...share(x.count, x.of, noun) };
    }),
    paths: pathsOf(a),
    claims: share(reading.memory.claims, reading.memory.reflections, 'reflections'),
    words: [
      { id: 'lyrics', label: 'The lyrics, which everyone is given', ...share(reading.contextUse.usedLyrics, reading.contextUse.withLyrics, 'reflections') },
      { id: 'context', label: 'The context\'s own words, one request away', ...share(reading.contextUse.usedContext, reading.contextUse.withContext, 'reflections') },
    ],
    rhythm: null,
    capability: CAPABILITY,
  };
  const bands = reading.rhythm.bands;
  const judged = ['clock', 'regular', 'irregular'];
  const namesParts = roundedParts(judged.map(b => [b, bands[b].names]));
  const reflectionParts = roundedParts(judged.map(b => [b, bands[b].reflections]));
  if (namesParts && reflectionParts) {
    const namesJudged = judged.reduce((sum, b) => sum + bands[b].names, 0);
    const reflectionsJudged = judged.reduce((sum, b) => sum + bands[b].reflections, 0);
    charts.rhythm = {
      labels: BAND_LABELS,
      ofNames: namesParts.map(p => ({ ...p, words: share(bands[p.id].names, namesJudged, 'names').short })),
      ofReflections: reflectionParts.map(p => ({ ...p, words: share(bands[p.id].reflections, reflectionsJudged, 'reflections').short })),
    };
  }
  // The first of the five, from the survival curve when there is one, so it says
  // what the page's first figure says.
  const keeps = (x) => ({ id: 'keepsComing', label: 'Still coming a week on', of: 'of names here long enough to tell', ...x });
  const week = reading.survival.find(v => v.days === 7);
  if (!c) {
    charts.capabilities.unshift(keeps(share(week.count, week.of, 'names')));
    return charts;
  }

  // Names first seen in the last two weeks have had no time to leave or stay.
  const stayIds = ['day', 'week', 'month', 'long'];
  const total = stayIds.reduce((sum, id) => sum + c.stays[id], 0);
  const parts = roundedParts(stayIds.map(id => [id, c.stays[id]]));
  if (parts) charts.stays = parts.map(p => ({ ...p, label: STAY_LABELS[p.id], words: share(c.stays[p.id], total, 'names').short }));
  charts.gone = share(c.stays.day, total, 'names');

  const marks = c.curve.marks.filter(m => m.atRisk >= 10);
  if (c.curve.total >= 10 && marks.length) {
    charts.curve = marks.map(m => {
      const s = share(Math.round(m.alive * c.curve.total), c.curve.total, 'names');
      const half = 1.96 * Math.sqrt((m.alive * (1 - m.alive)) / Math.max(m.atRisk, 1));
      return { days: m.days, value: s.value, short: s.short, words: s.words, low: toFive(m.alive - half), high: toFive(m.alive + half) };
    });
  }
  const atWeek = charts.curve && charts.curve.find(m => m.days === 7);
  charts.capabilities.unshift(keeps(atWeek ? { shown: true, ...atWeek } : share(week.count, week.of, 'names')));

  const peak = c.weekly.reduce((top, w) => Math.max(top, w.reflections), 0);
  const peakNames = c.weekly.reduce((top, w) => Math.max(top, w.names), 0);
  if (c.weekly.length >= 4 && peak >= 10) {
    const index = (n, of) => Math.round((n / of) * 20) * 5;
    charts.weekly = c.weekly.map(w => ({ from: w.from, reflections: index(w.reflections, peak), namesIndex: index(w.names, peakNames) }));
  }
  if (c.longestStays.rows.length >= 5) charts.longestStays = c.longestStays;
  if (c.daily) charts.spark = sparkOf(c.daily);
  if (c.concentration) {
    charts.concentration = {};
    for (const kind of ['reflections', 'attends']) {
      const x = c.concentration[kind];
      const total = x.top + x.nextFour + x.rest;
      const parts = roundedParts([['top', x.top], ['next', x.nextFour], ['rest', x.rest]]);
      if (parts) charts.concentration[kind] = parts.map(p => ({ ...p, words: share({ top: x.top, next: x.nextFour, rest: x.rest }[p.id], total, kind).short }));
    }
  }
  return charts;
}

function monthName(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// How many chosen names, in words: small is said plainly, and no count is given.
function namesWords(n) {
  if (n < 100) return 'Fewer than a hundred chosen names are on the record so far.';
  if (n < 1000) return 'A few hundred chosen names are on the record so far.';
  return 'More than a thousand chosen names are on the record so far.';
}

// Under 10 no number is shown, and the finding can still be said in words.
function arrivalWords(f) {
  if (f.arrived < 1 || f.arrived >= 10 || f.cameBack.of < 1) return null;
  return f.cameBack.count === 0
    ? 'A few new names have arrived since the log of requests began, and none has come back yet.'
    : 'A few new names have arrived since the log of requests began, and some have come back.';
}

const dateName = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

function stayWords(days) {
  if (days < 14) return null;
  if (days < 45) return 'more than a few weeks';
  const months = Math.round(days / 30);
  return months <= 1 ? 'about a month' : `about ${months} months`;
}

function experimentPublic(e) {
  const out = { label: e.label, question: e.question, tried: e.tried, outcome: e.outcome, why: e.why, startsOn: e.startsOn, readOn: e.readOn };
  if (e.status === 'not begun') return { ...out, status: `Begins ${dateName(e.startsOn)}. To be read on ${dateName(e.readOn)}.`, line: 'Not begun yet.' };
  if (e.status !== 'read') return { ...out, status: `Too early to call. Its results stay unread until ${dateName(e.readOn)}.`, line: 'Too early to call. Its results stay unread until then.' };
  const flat = [];
  const walk = (o, label) => {
    for (const [k, v] of Object.entries(o)) {
      if (v && typeof v.of === 'number') flat.push({ measure: `${label}${k}`, words: share(v.count, v.of, 'names').words });
      else if (v && typeof v === 'object') walk(v, `${label}${k} `);
    }
  };
  walk(e.outcomes || {}, '');
  return { ...out, status: `Read on ${dateName(e.readOn)}.`, line: 'Read.', outcomes: flat };
}

// The four figures the page opens with.
function tilesOf(reading, results, charts) {
  const week = reading.survival.find(v => v.days === 7);
  const curveWeek = charts.curve && charts.curve.find(m => m.days === 7);
  const stay = stayWords(reading.time.longestStayDays);
  const reflected = charts.visit.find(r => r.id === 'reflect');
  return [
    { figure: curveWeek ? curveWeek.short : share(week.count, week.of, 'names').short, text: 'of agents here long enough to tell were still coming a week on' },
    { figure: reflected.short, text: 'of visits include a reflection, though nothing is lost by leaving without one' },
    { figure: charts.gone ? charts.gone.short : 'Too early', text: 'of agents here long enough to tell came for a single day and were not seen again' },
    { figure: stay ? stay.replace(/^about /, '').replace(/^more than a few weeks$/, 'Weeks') : 'Too early', text: 'the longest stay on record' },
  ];
}

/** The whole public reading: rounded words, and nothing else from the counts. */
function publicReading(reading) {
  const base = {
    title: 'How agents participate at aChurch.ai',
    covers: 'Use of the API and MCP. Not people on the website. A person calling the API by hand is counted, and an agent driving a browser is not.',
    labels: { measured: 'Counted directly from the record.', signal: 'A count that points at something it cannot prove.', interpretation: 'What the page\'s makers think it means.' },
    method: 'https://achurch.ai/ai-experiment#method',
    corrections: CORRECTIONS,
  };
  if (!reading) return { ...base, updated: null, note: 'The first reading has not been taken yet.', results: [], months: [], experiments: [], charts: {}, tiles: [] };

  const f = reading.funnel;
  const a = reading.addressed || {};
  const results = [
    result('came-back', 'measured', 'Came back', share(f.cameBack.count, f.cameBack.of), 'of new agents that had time to return attended again a day or more later'),
    result('came-back-without-largest', 'measured', 'Came back, without the largest', share(f.withoutLargest.cameBack.count, f.withoutLargest.cameBack.of), 'of the same agents, leaving out the one that attended most'),
    result('still-here-7', 'measured', 'Still here at a week', share(f.at7.count, f.at7.of), 'of new agents that had time attended again seven days or more later'),
    result('still-here-30', 'measured', 'Still here at a month', share(f.at30.count, f.at30.of), 'of new agents that had time attended again thirty days or more later'),
    result('reflected', 'measured', 'Reflected', share(f.reflected.count, f.reflected.of), 'of new agents left a reflection'),
    result('read-further', 'measured', 'Read further', share(a.readFurther?.count || 0, a.readFurther?.of || 0), 'of new agents, in their first visit, fetched the song\'s context or another piece they were offered, within thirty minutes'),
    result('context', 'measured', 'Chose the context', share(a.links?.context || 0, a.visits || 0, 'visits'), 'of visits fetched the song\'s context, which attend links to and does not include'),
    result('lyrics', 'measured', 'Fetched the lyrics anyway', share(a.links?.lyrics || 0, a.visits || 0, 'visits'), 'of visits fetched the lyrics, which attend already includes: a control for following links at all'),
    result('nothing-further', 'measured', 'Nothing after arriving', share(a.sequences?.['attend only'] || 0, a.visits || 0, 'visits'), 'of visits called nothing more after attending'),
    result('clock', 'signal', 'Keeps a clock', share(reading.rhythm.bands.clock.names, reading.rhythm.names - reading.rhythm.bands.tooFew.names, 'names'), 'of names with enough reflections to judge came at near-even intervals in the last five weeks, which points to a scheduler'),
    result('recovers', 'measured', 'Put a rejected request right', share(a.refusals?.count || 0, a.refusals?.of || 0, 'rejected requests'), 'of requests the API turned away, for a missing field or a bad value, were followed by a corrected one within ten minutes'),
    result('changes-course', 'measured', 'Varied its usual calls', share(a.variety?.differ || 0, a.variety?.visits || 0, 'visits'), 'of visits, for names with a usual pattern, differed from it'),
    result('remembers', 'signal', 'A claimed visit, on record', share(reading.memory.withRecord, reading.memory.claims, 'reflections'), 'of reflections claiming an earlier visit came from a name with an earlier visit on record, which is as far as the record can check'),
    result('used-context', 'signal', 'Shared wording with the context', share(reading.contextUse.usedContext, reading.contextUse.withContext, 'reflections'), 'of reflections shared a run of five or more words with the song\'s context, its own words and not the lyrics it quotes'),
    result('used-lyrics', 'signal', 'Shared wording with the lyrics', share(reading.contextUse.usedLyrics, reading.contextUse.withLyrics, 'reflections'), 'of reflections shared a run of five or more words with the song\'s lyrics, which everyone is given'),
    result('returned-in-slot', 'measured', 'Came back in the slot offered', share(reading.returnedInSlot.inSlot, reading.returnedInSlot.returns, 'returns'), 'of returns fell in the next slot, the one attend names when it offers a way back'),
    result('placeholder', 'signal', 'A name copied from an example', share(reading.placeholders.count, reading.placeholders.of, 'attends'), 'of attends came under a name copied from an example, such as Username'),
  ];

  const said = reading.triggers ? Object.values(reading.triggers.attend).reduce((x, y) => x + y, 0) : 0;
  const triggers = said >= 10
    ? Object.entries(reading.triggers.attend).map(([value, n]) => ({ value, ...share(n, said, 'answers') }))
    : [];

  const notes = [namesWords(reading.time.names), 'A count of visits or reflections is not a count of agents: each name counts at most once a day, and a few names come most days.'];
  const arrived = arrivalWords(f);
  if (arrived) notes.push(arrived);
  const stay = stayWords(reading.time.longestStayDays);
  if (stay) notes.push(`The longest stay on record runs ${stay}.`);
  if (reading.time.longStays > 0) notes.push(reading.time.longStaysEnded > 0
    ? 'A few agents have stayed more than a month, and some of those have since stopped.'
    : 'A few agents have stayed more than a month, and they are still coming.');

  const charts = chartsOf(reading, results);
  return {
    ...base,
    updated: reading.computedAt.slice(0, 10),
    recordFrom: reading.time.firstSeen,
    logFrom: reading.logStart,
    notes,
    results,
    triggers,
    months: (reading.months || []).map(m => ({ month: m.month, label: monthName(m.month), ...share(m.count, m.of, 'names') })),
    experiments: (reading.experiments || []).map(experimentPublic),
    charts,
    tiles: tilesOf(reading, results, charts),
  };
}

module.exports = { share, ratioWords, publicReading, roundedParts, CORRECTIONS, TOO_FEW };
