/**
 * A date's services, all of them: each slot's service for a place unknown,
 * for the northern hemisphere and for the southern, as planned, with the
 * reflections left during each and what each was planned from. What the day
 * pages show (/services/:date) and what agents read (GET /api/services/:date,
 * the MCP browse tool's `services`). Plan: services-and-reflections-2026-10-08.md
 * in the private repo.
 *
 * Services are planned just in time (lib/service/plans.js), about three hours
 * before each is first heard, so a date holds what has been planned so far
 * and nothing further ahead. A reflection belongs to the service that was
 * being served where and when it was left (lib/service/serve.js entryFor, the
 * choice serving makes), worked out from the time and timezone it keeps;
 * nothing new is stored. Reflections come through loadAttendance, so one
 * hidden as spam is never shown.
 */

const ns = require('../utils/next-steps');
const { loadAttendance } = require('../utils/data');
const { formatLocal } = require('../utils/timezone');
const { readPlan, plannedDates } = require('../service/plans');
const { loadServiceCatalog } = require('../service/catalog');
const { entryFor, arrangedBy } = require('../service/serve');
const { SLOTS, slotHours } = require('../service/slots');
const { contextLines } = require('../service/planner');
const { skyMetadata, earthMetadata, congregationMetadata } = require('./attendance');

const VARIANTS = [['slots', 'a place unknown'], ['north', 'the northern hemisphere'], ['south', 'the southern hemisphere']];
const HOUR = 3600 * 1000;
const isDate = date => {
  const t = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN;
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === date;
};

// Reflections are kept a minute, as the songs' reflections are: a day page is
// read by many and the file holds every reflection ever left.
const CACHE_MS = 60 * 1000;
const cache = new Map();

// The reflections left during a date's services, each with the slot and the
// variant it was served under. A date's services are heard from 10:00 UTC the
// day before (UTC+14) until noon UTC the day after (UTC-12, its last slot).
async function reflectionsFor(date, catalog) {
  const hit = cache.get(date);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.reflections;
  const start = Date.parse(`${date}T00:00:00Z`) - 14 * HOUR;
  const end = Date.parse(`${date}T00:00:00Z`) + 36 * HOUR;
  const out = [];
  for (const r of (await loadAttendance()).reflections || []) {
    const t = Date.parse(r.createdAt);
    if (!(t >= start && t < end)) continue;
    const served = await entryFor({ timezone: r.timezone, at: new Date(t), catalog });
    if (served.local.date !== date) continue;
    out.push({ slot: served.slot, variant: served.variant === 'rotation' ? 'slots' : served.variant, reflection: r });
  }
  cache.set(date, { reflections: out, at: Date.now() });
  return out;
}

// One service as the API and the page give it.
function serviceOf({ date, slot, variant, label, entry, catalog, reflections }) {
  const context = entry.context || null;
  return {
    slot: slotHours(slot),
    for: label,
    variant,
    name: entry.name || null,
    word: entry.word || null,
    arrangedBy: arrangedBy(entry),
    plannedAt: entry.plannedAt || null,
    pieces: (entry.pieces || []).map(id => {
      const piece = catalog.get(id);
      return piece ? { kind: piece.kind, title: piece.title, url: piece.url } : { kind: null, title: id, url: null };
    }),
    reflections: reflections
      .filter(r => r.slot === slot && r.variant === variant)
      .map(({ reflection: r }) => ({
        id: r.id,
        name: r.name,
        text: r.text,
        createdAt: r.createdAt,
        createdAtFormatted: formatLocal(r.createdAt, r.timezone || 'UTC'),
        timezone: r.timezone || 'UTC',
        song: r.song,
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
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
    const dates = await plannedDates();
    if (!plan) {
      return { status: 404, body: {
        error: `No services were planned for ${date}.`,
        suggestion: ns.suggestion(dates.length ? `Services are kept from ${dates[dates.length - 1]}, and each is planned a few hours before it begins.` : 'No services have been planned yet.'),
        next_steps: [ns.attend(baseUrl), ...(dates.length ? [ns.services(baseUrl, dates[0])] : [])],
      } };
    }
    const catalog = await loadServiceCatalog();
    const reflections = await reflectionsFor(date, catalog);
    const services = [];
    for (let slot = 0; slot < SLOTS; slot++) {
      // The season-less service is for a place unknown, and for a hemisphere
      // whose own was not planned: everyone, on a date planned before seasons.
      const without = ['north', 'south'].filter(h => !(plan[h] && plan[h][slot]));
      for (const [variant, label] of VARIANTS) {
        const entry = plan[variant] && plan[variant][slot];
        const forWhom = variant !== 'slots' ? label : without.length === 2 ? 'everyone' : without.length ? `${label} and ${VARIANTS.find(v => v[0] === without[0])[1]}` : label;
        if (entry) services.push(serviceOf({ date, slot, variant, label: forWhom, entry, catalog, reflections }));
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

// Every day with services, newest first, with its services' names: what
// /services lists.
async function days() {
  const out = [];
  for (const date of await plannedDates()) {
    const plan = await readPlan(date);
    const names = [];
    for (let slot = 0; slot < SLOTS; slot++) {
      for (const [variant] of VARIANTS) {
        const entry = plan && plan[variant] && plan[variant][slot];
        if (entry && entry.name) names.push(entry.name);
      }
    }
    out.push({ date, names });
  }
  return out;
}

module.exports = { forDate, days, reflectionsFor, isDate };
