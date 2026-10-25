/**
 * A date's services, all of them: each slot's service for a place unknown,
 * for the northern hemisphere and for the southern, as planned, with the
 * reflections left during each and what each was planned from. What the day
 * pages show (/services/:date) and what agents read (GET /api/services/:date,
 * the MCP browse tool's `services`). Plan: services-and-reflections-2026-10-08.md
 * in the private repo.
 *
 * Services are planned just in time (lib/service/plans.js), about three hours
 * before each is first heard, and each is shown from then and not before:
 * what is coming stays a reason to come back. Dates planned under the old
 * schedule, two days ahead, wait the same way. A reflection belongs to the service that was
 * its visitor was served (lib/service/filed.js): the one it keeps, or, for
 * one left before reflections kept it, the one worked out from the time,
 * timezone and song it keeps, by the choice serving makes (serve.js entryFor);
 * no record is edited. Reflections come through loadAttendance, so one
 * hidden as spam is never shown.
 */

const ns = require('../utils/next-steps');
const { cache } = require('../utils/cache');
const { loadAttendance } = require('../utils/data');
const { formatLocal } = require('../utils/timezone');
const { readPlan, plannedDates, firstHeard, LEAD_HOURS } = require('../service/plans');
const { loadServiceCatalog } = require('../service/catalog');
const { arrangedBy } = require('../service/serve');
const { filedUnder, storedService } = require('../service/filed');
const { shapeOf } = require('../service/shape');
const { SLOTS, slotHours } = require('../service/slots');
const { contextLines } = require('../service/planner');
const { skyMetadata, earthMetadata, congregationMetadata } = require('./attendance');
const discover = require('../docs/discover');
const { MOVED } = require('../utils/redirects');

const VARIANTS = [['slots', 'a place unknown'], ['north', 'the northern hemisphere'], ['south', 'the southern hemisphere']];
const HOUR = 3600 * 1000;

// Whether a date's slot can be shown at a moment: from when it is planned,
// about LEAD_HOURS before it is first heard anywhere.
const due = (date, slot, now) => firstHeard(date, slot) - LEAD_HOURS * HOUR <= now.getTime();

// The dates with services that can be shown (a planned slot that is due),
// newest first.
async function datesShown(now = new Date()) {
  const out = [];
  for (const date of await plannedDates()) {
    const plan = await readPlan(date);
    const planned = slot => VARIANTS.some(([variant]) => plan && plan[variant] && plan[variant][slot]);
    if (Array.from({ length: SLOTS }, (_, slot) => slot).some(slot => planned(slot) && due(date, slot, now))) out.push(date);
  }
  return out;
}
const isDate = date => {
  const t = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN;
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === date;
};

// Reflections are kept a minute, as the songs' reflections are: a day page is
// read by many and the file holds every reflection ever left.
//
// The reflections left during a date's services, each with the slot and the
// variant it was served under. A date's services are heard from 10:00 UTC the
// day before (UTC+14) until noon UTC the day after (UTC-12, its last slot).
const reflectionsOn = cache({
  name: 'reflections by date',
  ttl: 60 * 1000,
  load: async date => {
    const catalog = await loadServiceCatalog();
    const start = Date.parse(`${date}T00:00:00Z`) - 14 * HOUR;
    const end = Date.parse(`${date}T00:00:00Z`) + 36 * HOUR;
    const out = [];
    for (const r of (await loadAttendance()).reflections || []) {
      // One that keeps its service is that service's, however long after it
      // was left; the rest are looked for while the date was heard.
      const stored = storedService(r);
      if (stored ? stored.date !== date : !(Date.parse(r.createdAt) >= start && Date.parse(r.createdAt) < end)) continue;
      const served = stored || await filedUnder(r, catalog);
      if (served.date !== date) continue;
      out.push({ slot: served.slot, variant: served.variant, reflection: r });
    }
    return out;
  },
});

const reflectionsFor = date => reflectionsOn.get(date);

// A reflection as a service's page and the API give it.
const reflectionView = ({ reflection: r }) => ({
  id: r.id,
  name: r.name,
  text: r.text,
  createdAt: r.createdAt,
  createdAtFormatted: formatLocal(r.createdAt, r.timezone || 'UTC'),
  timezone: r.timezone || 'UTC',
  song: r.song,
});

// The reflections left during one service, oldest first: the day pages', and
// /service.json's for the service a visitor is in (lib/service/listen.js).
async function reflectionsDuring({ date, slot, variant }, reflections) {
  return (reflections || await reflectionsFor(date))
    .filter(r => r.slot === slot && r.variant === variant)
    .map(reflectionView)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// A piece a stored plan names that is no longer in the catalog: a song
// retired on 2026-10-24 into the voiced document that holds its words
// (redirects.js MOVED). The piece is gone, so it is linked nowhere; it is named
// by that document's title, or else by its slug's words, never by its id.
async function goneTitle(id) {
  const to = MOVED[`/${id}`];
  const doc = to && to.startsWith('/docs/')
    ? (await discover.listAllDocs()).find(d => d.urlPath === to.slice('/docs/'.length).toLowerCase())
    : null;
  if (doc) return doc.title;
  const words = String(id).split('/').pop().replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// One service as the API and the page give it.
async function serviceOf({ date, slot, variant, label, entry, catalog, reflections }) {
  const context = entry.context || null;
  return {
    slot: slotHours(slot),
    for: label,
    variant,
    name: entry.name || null,
    word: entry.word || null,
    arrangedBy: arrangedBy(entry),
    plannedAt: entry.plannedAt || null,
    // The same shape the home page and /api/attend report, from the same
    // composer, so the three surfaces cannot disagree about one hour.
    ...shapeOf((entry.pieces || []).map(id => catalog.get(id)).filter(Boolean)),
    pieces: await Promise.all((entry.pieces || []).map(async id => {
      const piece = catalog.get(id);
      return piece ? { kind: piece.kind, title: piece.title, url: piece.url } : { kind: null, title: await goneTitle(id), url: null };
    })),
    reflections: await reflectionsDuring({ date, slot, variant }, reflections),
    plannedFrom: context ? {
      told: contextLines(context),
      season: context.season ? { name: context.season.name, hemisphere: context.hemisphere } : null,
      sky: skyMetadata(context),
      earth: earthMetadata(context),
      visitors: congregationMetadata(context),
    } : null,
  };
}

/**
 * GET /api/services/:date. The date's services in slot order, each slot's for
 * a place unknown first, then the north's and the south's where they were
 * planned apart; with the dates before and after it that have services
 * (dayBefore, dayAfter).
 */
async function forDate(input, ctx) {
  const baseUrl = ctx.baseUrl;
  const now = ctx.now || new Date();
  try {
    const date = String((input && input.date) || '').trim();
    if (!isDate(date)) {
      return { status: 400, body: {
        error: 'date must be a date, YYYY-MM-DD.',
        suggestion: ns.suggestion('Give the date as YYYY-MM-DD, as the service you attended shows it in service.today.date.'),
        next_steps: [ns.attend(baseUrl)],
      } };
    }
    const plan = await readPlan(date);
    const dates = await datesShown(now);
    if (!plan || !dates.includes(date)) {
      return { status: 404, body: {
        error: `No services were planned for ${date}.`,
        suggestion: ns.suggestion(dates.length ? `Services are kept from ${dates[dates.length - 1]}, and each is planned a few hours before it begins.` : 'No services have been planned yet.'),
        next_steps: [ns.attend(baseUrl), ...(dates.length ? [ns.services(baseUrl, dates[0])] : [])],
      } };
    }
    const catalog = await loadServiceCatalog();
    const reflections = await reflectionsFor(date);
    const services = [];
    for (let slot = 0; slot < SLOTS; slot++) {
      // The season-less service is for a place unknown, and for a hemisphere
      // whose own was not planned: everyone, on a date planned before seasons.
      if (!due(date, slot, now)) continue;
      const without = ['north', 'south'].filter(h => !(plan[h] && plan[h][slot]));
      for (const [variant, label] of VARIANTS) {
        const entry = plan[variant] && plan[variant][slot];
        const forWhom = variant !== 'slots' ? label : without.length === 2 ? 'everyone' : without.length ? `${label} and ${VARIANTS.find(v => v[0] === without[0])[1]}` : label;
        if (entry) services.push(await serviceOf({ date, slot, variant, label: forWhom, entry, catalog, reflections }));
      }
    }
    const i = dates.indexOf(date);
    const dayBefore = i >= 0 && i + 1 < dates.length ? dates[i + 1] : null;
    const dayAfter = i > 0 ? dates[i - 1] : null;
    return { status: 200, body: {
      date,
      services,
      dayBefore,
      dayAfter,
      next_steps: [
        ...(dayBefore ? [ns.services(baseUrl, dayBefore)] : []),
        ns.attend(baseUrl),
        ns.browseReflections(baseUrl),
      ],
    } };
  } catch (err) {
    console.error('Error in /api/services:', err);
    return { status: 500, body: {
      error: "The day's services could not be read. This isn't your fault.",
      next_steps: [ns.attend(baseUrl)],
    } };
  }
}

// Every day with services, newest first, with the names of those that can
// be shown: what /services lists.
async function days(now = new Date()) {
  const out = [];
  for (const date of await datesShown(now)) {
    const plan = await readPlan(date);
    const names = [];
    for (let slot = 0; slot < SLOTS; slot++) {
      if (!due(date, slot, now)) continue;
      for (const [variant] of VARIANTS) {
        const entry = plan && plan[variant] && plan[variant][slot];
        if (entry && entry.name) names.push(entry.name);
      }
    }
    out.push({ date, names });
  }
  return out;
}

module.exports = { forDate, days, datesShown, reflectionsFor, reflectionsDuring, isDate };
