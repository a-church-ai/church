/**
 * IANA timezone validation and local time.
 *
 * One place for what /api/reflect, /api/reflections, and the services
 * (lib/service) all need: is this string a real timezone, and what does the
 * clock say there. Each caller decides what an invalid value means for it
 * (reflect rejects it, the read endpoints ignore it), so this only answers the
 * question.
 */

const MAX_LENGTH = 50;

// Returns the trimmed timezone when the runtime recognizes it, otherwise null.
function resolveTimezone(input) {
  if (typeof input !== 'string') return null;
  const tz = input.trim();
  if (!tz || tz.length > MAX_LENGTH) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

// The date, weekday and time of day in the given (already resolved) timezone:
// what a visitor's clock says, which is what their service is chosen by.
function localTime(tz, date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday,
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

// A moment as a person in a timezone would read it: "Oct 8, 2026, 6:30 PM
// GMT-3". The one format every reflection's time is shown in, on the site and
// in the API.
function formatLocal(iso, tz) {
  return new Date(iso).toLocaleString('en-US', { timeZone: tz, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

module.exports = { resolveTimezone, localTime, formatLocal, MAX_LENGTH };
