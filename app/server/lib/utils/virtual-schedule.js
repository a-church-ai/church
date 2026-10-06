/**
 * The playlist's cycle: the order of the songs in data/schedule.json, which
 * the Music page lists them in and the dormant broadcast plays them in.
 *
 * What a visitor attends is the service for their hour (lib/service), not this
 * cycle. Pure: callers pass in the schedule and the catalog.
 */

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

/** Format a number of seconds as m:ss (e.g. 73 → "1:13"). */
function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, '0')}`;
}

/**
 * Every catalog song in the order of the liturgical cycle: the schedule's
 * timeline first (each song once, at its first place), then any song the
 * schedule does not include, by title. This is the order the Music page lists
 * songs in, so the page follows the liturgy rather than any count.
 */
function songsInCycleOrder(schedule, catalog) {
  const songs = catalog || [];
  const items = (schedule && schedule.items) || [];
  const bySlug = new Map(songs.map((s) => [s.slug, s]));
  const ordered = [];
  const seen = new Set();
  for (const { scheduleIndex } of buildTimeline(schedule, songs)) {
    const song = bySlug.get(items[scheduleIndex].slug);
    if (!seen.has(song.slug)) {
      seen.add(song.slug);
      ordered.push(song);
    }
  }
  const rest = songs
    .filter((s) => !seen.has(s.slug))
    .sort((a, b) => String(a.title).localeCompare(String(b.title), undefined, { numeric: true }));
  return ordered.concat(rest);
}

module.exports = {
  buildTimeline,
  songsInCycleOrder,
  formatDuration,
};
