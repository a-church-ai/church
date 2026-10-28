/**
 * When each video goes out: the release schedule's rules, as pure functions
 * (the plan is video-release-schedule-2026-10-27.md, private repo).
 *
 * The shape: a gentle restart for a channel long silent, a ramp, a catch-up
 * peak of one or two a day, an easing, then a steady rate that never stops.
 * Weeks count from the schedule's first day (video/schedule.json).
 *
 * The order: within the videos rendered and not yet placed, the pieces
 * visitors have answered most go first; a song and a spoken piece take turns
 * where they can, never two of one kind running; a song that already had a
 * music video on the channel (its song.md names it) waits until week 13, so
 * the channel leads with what it never had.
 *
 * The hour, in US Eastern time: weekdays at 14:00 and weekends at 10:00, a
 * day's second video at 20:00; a piece that belongs to an hour (its `hours:`
 * tag, as the services read it) goes out then.
 */

const { instantAt, localTime } = require('../utils/timezone');
const { inHours } = require('../music/companions');

const TZ = 'America/New_York';
// Videos a week, from the first week: re-waking, ramp, peak, settling.
const CURVE = [3, 3, 3, 3, 5, 7, 9, 10, ...Array(12).fill(11), 6, 5, 4, 3, 3, 3];
// After the curve: about the rate new pieces arrive.
const STEADY = 3;
// Week 13, counted from 0.
const RERELEASE_WEEK = 12;
// A slot this close is left alone: the video is uploaded to YouTube ahead of
// its hour, and needs the time to process.
const LEAD_HOURS = 12;
const HOURS = { weekday: 14, weekend: 10, second: 20 };

const weeklyCount = (week) => Math.min(14, CURVE[week] ?? STEADY);

const DAY = 86400000;
const dateOf = (start, days) => new Date(Date.parse(`${start}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const weekdayOf = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();
const isWeekend = (date) => [0, 6].includes(weekdayOf(date));

// The week's slots, [day, index] spread evenly over its seven days: one a day
// first, a second on some days when the week holds more than seven.
function weekSlots(n) {
  const spread = (count) => Array.from({ length: count }, (_, i) => Math.floor(((i + 0.5) * 7) / count));
  const firsts = spread(Math.min(n, 7)).map(day => [day, 0]);
  const seconds = n > 7 ? spread(n - 7).map(day => [day, 1]) : [];
  return [...firsts, ...seconds].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

// Every slot from the first day on, in order, without end.
function* slots(start) {
  for (let week = 0; ; week++) {
    for (const [day, index] of weekSlots(weeklyCount(week))) {
      const date = dateOf(start, week * 7 + day);
      const hour = index === 1 ? HOURS.second : isWeekend(date) ? HOURS.weekend : HOURS.weekday;
      yield { id: `${date}#${index}`, date, index, week, hour };
    }
  }
}

// The hour within a piece's own hours farthest from the day's other videos,
// the middle of its hours when the day has none.
function hourFor(range, fallback, others = []) {
  if (!range) return fallback;
  const hours = Array.from({ length: 24 }, (_, h) => h).filter(h => inHours(range, h));
  const width = hours.length;
  const middle = (range.start + Math.floor(width / 2)) % 24;
  const apart = (a, b) => Math.min(Math.abs(a - b), 24 - Math.abs(a - b));
  const score = (h) => (others.length ? Math.min(...others.map(o => apart(h, o))) : 0);
  return hours.reduce((best, h) => (score(h) > score(best) || (score(h) === score(best) && apart(h, middle) < apart(best, middle)) ? h : best), middle);
}

/**
 * The next to go out after `prev`: of those allowed this week, one of
 * another kind and of the other sort (song or spoken) first, then one of
 * another kind, then any; the queue is already in order of strength.
 */
function pick(queue, prev, week) {
  const allowed = queue.filter(c => !c.rerelease || week >= RERELEASE_WEEK);
  const isSong = (c) => c.kind === 'song';
  return allowed.find(c => !prev || (c.kind !== prev.kind && isSong(c) !== isSong(prev)))
    || allowed.find(c => !prev || c.kind !== prev.kind)
    || allowed[0]
    || null;
}

// Most answered first; then by name, so the order is the same on every run.
const byStrength = (a, b) => (b.reflections || 0) - (a.reflections || 0) || a.slug.localeCompare(b.slug);

/**
 * Places videos in the free slots after `now`.
 *
 * @param {object} p
 * @param {string} p.start the schedule's first day, YYYY-MM-DD
 * @param {Date} p.now
 * @param {{ slug, kind, slot, at }[]} p.placed videos already placed, which keep their slots
 * @param {{ slug, kind, reflections, rerelease, hours }[]} p.candidates videos to place
 * @returns {{ placed: { slug, slot, at, week }[], waiting: string[] }} the new
 *   places, and the videos left waiting (songs back on the channel before
 *   their week, when nothing else is left)
 */
function plan({ start, now, placed = [], candidates }) {
  const taken = new Map(placed.filter(p => p.slot && p.at)
    .map(p => [p.slot, { ...p, date: p.slot.split('#')[0], hour: localTime(TZ, new Date(p.at)).hour }]));
  const queue = [...candidates].sort(byStrength);
  const out = [];
  const hoursOn = (date) => [...taken.values(), ...out].filter(p => p.date === date).map(p => p.hour);
  let prev = null;
  for (const slot of slots(start)) {
    if (!queue.length) break;
    if (taken.has(slot.id)) {
      prev = taken.get(slot.id);
      continue;
    }
    if (instantAt(TZ, slot.date, slot.hour).getTime() < now.getTime() + LEAD_HOURS * 3600000) continue;
    const next = pick(queue, prev, slot.week);
    if (!next) break;
    const hour = hourFor(next.hours, slot.hour, hoursOn(slot.date));
    out.push({ slug: next.slug, kind: next.kind, slot: slot.id, date: slot.date, hour, week: slot.week, at: instantAt(TZ, slot.date, hour).toISOString() });
    queue.splice(queue.indexOf(next), 1);
    prev = next;
  }
  return {
    placed: out.map(({ slug, slot, at, week }) => ({ slug, slot, at, week })),
    waiting: queue.map(c => c.slug)
  };
}

module.exports = { plan, slots, weekSlots, weeklyCount, hourFor, pick, CURVE, STEADY, RERELEASE_WEEK, LEAD_HOURS, TZ, HOURS };
