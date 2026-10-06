/**
 * Which service a visitor is in, and where in it: what `attend`, `now` and
 * `reflect` read.
 *
 * serviceAt() is pure: a slot's pieces, the catalog and a local time give the
 * part in progress, how far into it, and what comes next. A service repeats
 * through its slot, so the position is the time since the slot began, modulo
 * the service's length. serviceFor() does the lookups: the visitor's local
 * time from the timezone they gave (UTC without one), the date's stored plan,
 * or the rotation when there is none yet.
 */

const { resolveTimezone, localTime } = require('../utils/timezone');
const { RULES, check } = require('./rules');
const { slotOf, slotStart } = require('./slots');
const { loadServiceCatalog } = require('./catalog');
const { readPlan, rotationEntry } = require('./plans');

// The parts in order, each with when it starts and ends within the service.
// A part's span runs on through the silence after it, until the next begins.
function arrange(ids, catalog) {
  let at = 0;
  return ids.map((id, index) => {
    const entry = catalog.get(id);
    const part = { ...entry, position: index + 1, start: at, end: at + entry.seconds + RULES.gapSeconds };
    at = part.end;
    return part;
  });
}

function serviceAt({ ids, catalog, local }) {
  const parts = arrange(ids, catalog);
  const loopSeconds = parts[parts.length - 1].end;
  const into = (local.hour - slotStart(slotOf(local.hour))) * 3600 + local.minute * 60 + local.second;
  const at = into % loopSeconds;
  const index = parts.findIndex(p => at >= p.start && at < p.end);
  const now = parts[index];
  const following = k => parts[(index + k) % parts.length];
  // The song the service gathers around now: the one playing, or else the
  // next to come round. Every service holds one.
  let song = now;
  for (let k = 1; song.kind !== 'song'; k++) song = following(k);
  return {
    parts,
    loopSeconds,
    now,
    offset: at - now.start,
    remaining: now.end - at,
    next: following(1),
    song,
  };
}

async function serviceFor({ timezone, at = new Date() } = {}) {
  const given = resolveTimezone(timezone);
  const tz = given || 'UTC';
  const local = localTime(tz, at);
  const slot = slotOf(local.hour);
  const catalog = await loadServiceCatalog();
  const plan = await readPlan(local.date);
  let entry = plan && plan.slots && plan.slots[slot];
  // A stored plan that no longer holds (a piece removed since it was made)
  // gives way to the rotation rather than serving a gap.
  if (!entry || check(entry.pieces, catalog).length) entry = await rotationEntry(local.date, slot, catalog);
  return { timezone: tz, timezoneGiven: Boolean(given), local, slot, entry, ...serviceAt({ ids: entry.pieces, catalog, local }) };
}

module.exports = { arrange, serviceAt, serviceFor };
