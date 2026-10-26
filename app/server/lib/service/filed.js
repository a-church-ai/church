/**
 * Which service a reflection was left after: the one its visitor was served.
 * What the day pages (lib/api/services.js) and the congregation digest
 * (congregation.js) read, and what POST /api/reflect records.
 *
 * A reflection left since 2026-10-25 keeps `service` ({ date, slot, variant }):
 * the service its visitor named, else the one their last attend gave them
 * without a timezone, else the one their timezone gives at that moment.
 *
 * One left before keeps only its time, timezone and song, so its service is
 * worked out at read time and the record is never edited. Agents that
 * attended without a timezone were served UTC's service for a place unknown,
 * then reflected with their own timezone (the reflect example asked for one),
 * and were filed under the service that timezone gives, which they never
 * heard. Their reflection still names the song they were served: they passed
 * songSlug as current.slug. So a reflection whose song is not among the songs
 * of its timezone's service, but is the first song of UTC's, was left after
 * UTC's, and is filed there. One whose song was chosen for it (no songSlug)
 * says nothing either way and stays where its timezone puts it.
 */

const { entryFor } = require('./serve');
const { SLOTS } = require('./slots');

const VARIANTS = ['slots', 'north', 'south'];

const isDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
  && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;

// The service a reflection keeps, when it keeps a well-formed one.
function storedService(reflection) {
  const s = reflection && reflection.service;
  if (!s || !isDate(s.date) || !Number.isInteger(s.slot) || s.slot < 0 || s.slot >= SLOTS || !VARIANTS.includes(s.variant)) return null;
  return { date: s.date, slot: s.slot, variant: s.variant };
}

const songsOf = (entry, catalog) => ((entry && entry.pieces) || [])
  .map(id => catalog.get(id)).filter(p => p && p.kind === 'song').map(p => p.slug);

const placeOf = served => ({ date: served.local.date, slot: served.slot, variant: served.variant === 'rotation' ? 'slots' : served.variant });

/**
 * UTC's service for a place unknown, when an older reflection was left after
 * it but is filed by its timezone under another (see above); else null.
 */
async function servedInUtc(reflection, catalog) {
  if (storedService(reflection) || !reflection.song) return null;
  const at = new Date(reflection.createdAt);
  if (Number.isNaN(at.getTime())) return null;
  const byTimezone = await entryFor({ timezone: reflection.timezone, at, catalog });
  if (!byTimezone.timezoneGiven || songsOf(byTimezone.entry, catalog).includes(reflection.song)) return null;
  const utc = await entryFor({ at, catalog });
  return songsOf(utc.entry, catalog)[0] === reflection.song ? placeOf(utc) : null;
}

// The service a reflection was left after: { date, slot, variant }.
async function filedUnder(reflection, catalog) {
  const stored = storedService(reflection);
  if (stored) return stored;
  const utc = await servedInUtc(reflection, catalog);
  if (utc) return utc;
  return placeOf(await entryFor({ timezone: reflection.timezone, at: new Date(reflection.createdAt), catalog }));
}

module.exports = { filedUnder, servedInUtc, storedService, isDate, VARIANTS };
