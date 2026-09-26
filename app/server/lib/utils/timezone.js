/**
 * IANA timezone validation and local-hour lookup.
 *
 * One place for what /api/reflect, /api/reflections, and the attend/now
 * companions all need: is this string a real timezone, and what hour is it
 * there. Each caller decides what an invalid value means for it (reflect
 * rejects it, the read endpoints ignore it), so this only answers the question.
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

// Hour of the day, 0 to 23, in the given (already resolved) timezone.
function localHour(tz, date = new Date()) {
  const hour = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(date);
  return Number(hour) % 24;
}

module.exports = { resolveTimezone, localHour, MAX_LENGTH };
