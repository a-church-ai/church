/**
 * A table's rows, kept in memory and brought up to date by reading only what
 * is new, so a refresh is two small queries, not the whole table a thousand
 * rows at a time. Reflections (./data.js), conversation turns (./data.js) and
 * the API log the study reads (../insights/study-record.js) are kept this way.
 *
 * The first load reads everything. After that a load reads the rows made since
 * a little before the newest one held (OVERLAP), merges them by id, and asks
 * the table how many rows it has. The overlap covers a row whose time was taken
 * before another's but which was written after it, since a row's time is set
 * when its request arrives. The count covers the rest: a row deleted, or one
 * written with an older time than the overlap reaches (a record copied in by a
 * script). When the count and what is held disagree, the load reads everything
 * again, so nothing can drift for longer than one refresh.
 *
 * A row once held is not read again, so a table kept this way is one whose rows
 * are not edited, or whose edits the keeper makes itself: `forget(row, now)`
 * runs over every held row on each load and returns it as it should now be
 * held. The API log uses it to let go of an address past the days the database
 * keeps one (lib/utils/access-log.js), so memory never holds what the table has
 * forgotten.
 *
 * Loads may overlap (a cache starts a fresh one when a write clears it), so each
 * builds its result from what it read and sets it whole; a merge by id gives
 * the same set whichever finishes first, and a disagreement left by a race is
 * caught by the next load's count.
 */

const OVERLAP_MS = 10 * 60 * 1000;

/**
 * all(): every row, oldest first. since(iso): those made at or after a moment.
 * count(): how many rows the table has. idOf and timeOf read a row's key and
 * its ISO time. Returns load(), which gives every row held, oldest first (each
 * caller its own array); reset(), after which the next load reads the whole
 * table (the tests' reset_for_tests replaces every table and reuses ids, which
 * no count can see); and stats() for tests and logs.
 */
function keptRows({ all, since, count, idOf = r => r.id, timeOf = r => r.createdAt, forget = null, overlapMs = OVERLAP_MS, now = Date.now }) {
  let held = null; // { byId: Map, list: [] }
  const stats = { full: 0, delta: 0 };
  const order = (a, b) => {
    const [ta, tb] = [timeOf(a), timeOf(b)];
    if (ta !== tb) return ta < tb ? -1 : 1;
    const [ia, ib] = [idOf(a), idOf(b)];
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  };

  const set = (list, at) => {
    const kept = forget ? list.map(r => forget(r, at)) : list;
    const sorted = [...kept].sort(order);
    held = { byId: new Map(sorted.map(r => [idOf(r), r])), list: sorted };
    return [...sorted];
  };

  async function full(at) {
    stats.full++;
    return set(await all(), at);
  }

  // `at` is the moment forget measures from: now, unless a caller reads the
  // table as of another time (the study's tests run it at a set date).
  async function load({ at = now() } = {}) {
    if (!held || !held.list.length) return full(at);
    const base = held;
    const newest = timeOf(base.list[base.list.length - 1]);
    const from = new Date(Date.parse(newest) - overlapMs).toISOString();
    const [fresh, rows] = await Promise.all([since(from), count()]);
    const byId = new Map(base.byId);
    for (const r of fresh) byId.set(idOf(r), r);
    if (byId.size !== rows) return full(at);
    stats.delta++;
    return set([...byId.values()], at);
  }

  return { load, reset: () => { held = null; }, stats: () => ({ ...stats, held: held ? held.list.length : 0 }) };
}

module.exports = { keptRows, OVERLAP_MS };
