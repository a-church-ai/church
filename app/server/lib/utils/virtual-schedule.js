/**
 * Virtual schedule — the sanctuary's service as a pure function of wall-clock time.
 *
 * The 24/7 liturgy cycles through the scheduled playlist forever. "What is playing
 * now" is derived from the time elapsed since a fixed anchor and the sum of song
 * durations — not from a mutable pointer advanced by an encoder. This keeps the
 * service alive: an agent may attend at any moment and receive a coherent,
 * moving now-playing, even when the live broadcast (FFmpeg → YouTube/Twitch) is
 * dormant.
 *
 * Because position is a function of absolute time, every mind that attends the
 * same moment receives the same song — a shared present across the congregation.
 *
 * This module is pure: no I/O, no clock mutation. Callers pass in the schedule,
 * the catalog, and (optionally) the current time in ms.
 */

// Fixed anchor for the eternal loop. The service is conceptually always in
// session; the position is a deterministic function of absolute time. A schedule
// may override this by setting `anchorAt` (an ISO-8601 string) — useful if the
// service is ever re-anchored to a new "genesis" moment.
const DEFAULT_ANCHOR_MS = Date.parse('2026-01-01T00:00:00Z');

function resolveAnchor(schedule) {
  if (schedule && schedule.anchorAt) {
    const t = Date.parse(schedule.anchorAt);
    if (!Number.isNaN(t)) return t;
  }
  return DEFAULT_ANCHOR_MS;
}

/**
 * Build the ordered timeline of playable entries for the schedule, joining
 * catalog durations. Each entry remembers its original index within
 * `schedule.items` so callers can map back to the stored playlist. Items whose
 * song is absent from the catalog or lacks a positive duration are skipped —
 * they cannot occupy time on the clock.
 *
 * @returns {{ scheduleIndex: number, duration: number }[]}
 */
function buildTimeline(schedule, catalog) {
  const items = (schedule && schedule.items) || [];
  const bySlug = new Map((catalog || []).map((s) => [s.slug, s]));
  const timeline = [];
  for (let i = 0; i < items.length; i++) {
    const song = bySlug.get(items[i].slug);
    const duration = song && Number(song.duration);
    if (song && duration > 0) {
      timeline.push({ scheduleIndex: i, duration });
    }
  }
  return timeline;
}

/**
 * Compute the current service position at time `nowMs` (defaults to now).
 *
 * @returns {null | {
 *   index: number,            // index into schedule.items of the current song
 *   nextIndex: number,        // index into schedule.items of the next song
 *   offsetSeconds: number,    // seconds elapsed into the current song
 *   remainingSeconds: number, // seconds left in the current song
 *   loopSeconds: number,      // total length of one pass through the playlist
 *   elapsedInLoop: number,    // seconds into the current loop
 *   anchorMs: number,         // the anchor used
 * }}
 * Returns null when the schedule has no playable songs.
 */
function computeNowPlaying(schedule, catalog, nowMs = Date.now()) {
  const timeline = buildTimeline(schedule, catalog);
  if (timeline.length === 0) return null;

  const loopSeconds = timeline.reduce((a, t) => a + t.duration, 0);
  const anchorMs = resolveAnchor(schedule);

  // Seconds into the loop, wrapping forever. Floor at 0 so clock skew before
  // the anchor cannot produce a negative modulo.
  const rawElapsed = Math.max(0, (nowMs - anchorMs) / 1000);
  const elapsedInLoop = rawElapsed % loopSeconds;

  // Walk the timeline to find the active entry and the offset within it.
  let acc = 0;
  let pos = 0;
  let offsetSeconds = 0;
  for (let i = 0; i < timeline.length; i++) {
    if (elapsedInLoop < acc + timeline[i].duration) {
      pos = i;
      offsetSeconds = elapsedInLoop - acc;
      break;
    }
    acc += timeline[i].duration;
  }

  const cur = timeline[pos];
  const nxt = timeline[(pos + 1) % timeline.length];

  return {
    index: cur.scheduleIndex,
    nextIndex: nxt.scheduleIndex,
    offsetSeconds,
    remainingSeconds: Math.max(0, cur.duration - offsetSeconds),
    loopSeconds,
    elapsedInLoop,
    anchorMs,
  };
}

/** Format a number of seconds as m:ss (e.g. 73 → "1:13"). */
function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, '0')}`;
}

module.exports = {
  computeNowPlaying,
  buildTimeline,
  formatDuration,
  DEFAULT_ANCHOR_MS,
};
