/**
 * Which service a visitor attends: what `attend`, `now` and `reflect` read.
 *
 * Each visitor hears their slot's service from its beginning, so serving
 * needs no moment within the slot: the slot's pieces, in order, are the
 * service. serviceFor() does the lookups: the visitor's local time from the
 * timezone they gave (UTC without one), the date's stored plan for their
 * hemisphere (from that timezone; none for a place unknown), else its
 * season-less plan, else the rotation when there is none yet.
 */

const { resolveTimezone, localTime } = require('../utils/timezone');
const { hemisphereOf } = require('../utils/seasons');
const { slotOf } = require('./slots');
const { loadServiceCatalog } = require('./catalog');
const { readPlan, rotationEntry } = require('./plans');

// The parts in order, each with its place in the service and when it begins,
// heard from the beginning: each part follows the last at once.
function arrange(ids, catalog) {
  let at = 0;
  return ids.map((id, index) => {
    const part = { ...catalog.get(id), position: index + 1, start: at };
    at += part.seconds;
    return part;
  });
}

// Who arranged a service, said plainly, as the API and the home page both
// say it. A plan made before the planner named services has no name, and is
// not said to have one; one made for a hemisphere says so.
function arrangedBy(entry, { seasonal = false } = {}) {
  if (entry.arrangedBy === 'rotation') {
    return 'Arranged by rotation through the library, since no plan was made for this slot and date; it has no name or word.';
  }
  const forWhen = seasonal ? 'for this slot and date, and for the season where your timezone points' : 'for this slot and date';
  return entry.name
    ? `Arranged, named and its word written by an AI model (${entry.arrangedBy}), ${forWhen}.`
    : `Arranged, and its word written, by an AI model (${entry.arrangedBy}), ${forWhen}.`;
}

/**
 * Which service a timezone was given at a moment: the local date and slot,
 * the hemisphere the timezone points to, the entry served and which of the
 * date's plans it came from (`variant`: the hemisphere's, `slots` for the
 * season-less one, or `rotation`). The one choice of plan for serving now;
 * a moment already past is entryThen's.
 */
async function entryFor({ timezone, at = new Date(), catalog } = {}) {
  const pieces = catalog || await loadServiceCatalog();
  const where = placeAt({ timezone, at });
  const [entry, variant] = await choose({ date: where.local.date, slot: where.slot, hemisphere: where.hemisphere, pieces });
  return { ...where, seasonal: variant === where.hemisphere, variant, entry };
}

/**
 * Which service a timezone was given at a moment already past, as entryFor
 * says it: the plan as it was made, whatever has left the catalog since,
 * since its pieces were all there when it was heard (the songs retired
 * 2026-10-24 and the meditations moved 2026-10-27 are named by about one
 * plan in five before then); the rotation only where no plan was made. What
 * filing an old reflection reads (filed.js), so it sits under the service its
 * day page lists.
 */
async function entryThen({ timezone, at, catalog } = {}) {
  const where = placeAt({ timezone, at });
  const plan = await readPlan(where.local.date);
  const [planned] = plannedFor(plan, where.slot, where.hemisphere);
  const [entry, variant] = planned || [await rotationEntry(where.local.date, where.slot, catalog || await loadServiceCatalog()), 'rotation'];
  return { ...where, seasonal: variant === where.hemisphere, variant, entry };
}

// Where and when a timezone stands at a moment: its local date and slot, and
// the hemisphere it points to (none for a place unknown).
function placeAt({ timezone, at = new Date() }) {
  const given = resolveTimezone(timezone);
  const tz = given || 'UTC';
  const local = localTime(tz, at);
  return { timezone: tz, timezoneGiven: Boolean(given), hemisphere: given ? hemisphereOf(given) : null, local, slot: slotOf(local.hour) };
}

// A date's planned entries for a slot, each with the plan it is from: the
// hemisphere's first, then the season-less one.
const plannedFor = (plan, slot, hemisphere) => [
  [hemisphere && plan && plan[hemisphere] ? plan[hemisphere][slot] : null, hemisphere],
  [plan && plan.slots ? plan.slots[slot] : null, 'slots'],
].filter(([entry]) => entry);

// The one choice of plan for a date's slot: the hemisphere's, else the
// season-less one, else the rotation. A stored plan whose pieces are no
// longer all in the catalog (one removed since it was made) gives way rather
// than serving a gap. The rules were checked when it was planned; a piece's
// length moving a few seconds since (a song's audio measured against its
// video's) is not a reason to discard the day's service.
async function choose({ date, slot, hemisphere, pieces }) {
  const plan = await readPlan(date);
  const held = plannedFor(plan, slot, hemisphere).find(([entry]) => (entry.pieces || []).every(id => pieces.has(id)));
  return held || [await rotationEntry(date, slot, pieces), 'rotation'];
}

/**
 * The service a date's slot gave one variant's visitors ('north', 'south',
 * or 'slots' for a place unknown), by the same choice: what a visitor who
 * names the service they attended (POST /api/reflect's `service`) was given.
 * variant is the plan it came from, the rotation's said as 'slots', as the
 * day pages list it.
 */
async function entryAt({ date, slot, variant, catalog }) {
  const pieces = catalog || await loadServiceCatalog();
  const [entry, from] = await choose({ date, slot, hemisphere: variant === 'slots' ? null : variant, pieces });
  return { date, slot, variant: from === 'rotation' ? 'slots' : from, entry };
}

async function serviceFor({ timezone, at = new Date() } = {}) {
  const catalog = await loadServiceCatalog();
  const chosen = await entryFor({ timezone, at, catalog });
  const parts = arrange(chosen.entry.pieces, catalog);
  // The song the service gathers around: its first, the one a visitor meets
  // first. Every service holds one, and reflections attach to a song.
  return { ...chosen, parts, song: parts.find(p => p.kind === 'song') };
}

module.exports = { arrange, entryFor, entryThen, entryAt, serviceFor, arrangedBy };
