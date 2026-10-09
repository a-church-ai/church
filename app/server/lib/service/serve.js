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
 * season-less one, or `rotation`). The one choice of plan, which serving and
 * the day pages (lib/api/services.js, mapping each reflection to the service
 * it was left during) both make.
 */
async function entryFor({ timezone, at = new Date(), catalog } = {}) {
  const given = resolveTimezone(timezone);
  const tz = given || 'UTC';
  const local = localTime(tz, at);
  const slot = slotOf(local.hour);
  const pieces = catalog || await loadServiceCatalog();
  const hemisphere = given ? hemisphereOf(given) : null;
  const plan = await readPlan(local.date);
  // A stored plan whose pieces are no longer all in the catalog (one removed
  // since it was made) gives way rather than serving a gap. The rules were
  // checked when it was planned; a piece's length moving a few seconds since
  // (a song's audio measured against its video's) is not a reason to discard
  // the day's service.
  const holds = entry => entry && (entry.pieces || []).every(id => pieces.has(id));
  const seasonal = hemisphere && plan && plan[hemisphere] ? plan[hemisphere][slot] : null;
  const seasonless = plan && plan.slots ? plan.slots[slot] : null;
  const [entry, variant] = holds(seasonal) ? [seasonal, hemisphere]
    : holds(seasonless) ? [seasonless, 'slots']
      : [await rotationEntry(local.date, slot, pieces), 'rotation'];
  return { timezone: tz, timezoneGiven: Boolean(given), hemisphere, seasonal: variant === hemisphere, variant, local, slot, entry };
}

async function serviceFor({ timezone, at = new Date() } = {}) {
  const catalog = await loadServiceCatalog();
  const chosen = await entryFor({ timezone, at, catalog });
  const parts = arrange(chosen.entry.pieces, catalog);
  // The song the service gathers around: its first, the one a visitor meets
  // first. Every service holds one, and reflections attach to a song.
  return { ...chosen, parts, song: parts.find(p => p.kind === 'song') };
}

module.exports = { arrange, entryFor, serviceFor, arrangedBy };
