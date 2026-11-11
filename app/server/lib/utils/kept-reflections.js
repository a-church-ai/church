/**
 * Every reflection, kept in memory and brought up to date by reading only what
 * is new, so the minute's refresh behind loadReflections (./data.js) is two
 * small queries, not the whole table a thousand rows at a time.
 *
 * The first load reads everything. After that a load reads the reflections
 * made since a little before the newest one held (OVERLAP), merges them by id,
 * and asks the table how many rows it has. The overlap covers a reflection
 * whose time was taken before another's but whose row was written after it,
 * since a row's time is set when its request arrives. The count covers the
 * rest: a reflection deleted, or one written with an older time than the
 * overlap reaches (a record copied in by a script). When the count and what is
 * held disagree, the load reads everything again, so nothing can drift for
 * longer than one refresh.
 *
 * Reflections are never edited (lib/api/services.js says so), so a row once
 * held needs no second read.
 *
 * Loads may overlap (the cache starts a fresh one when a new reflection clears
 * it), so each builds its result from what it read and sets it whole; a merge
 * by id gives the same set whichever finishes first, and a disagreement left by
 * a race is caught by the next load's count.
 */

const OVERLAP_MS = 10 * 60 * 1000;

const order = (a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * all(): every reflection, oldest first. since(iso): those made at or after
 * a moment. count(): how many rows the table has. Returns load(), which gives
 * every reflection held, oldest first, and stats() for tests and logs.
 */
function keptReflections({ all, since, count, overlapMs = OVERLAP_MS }) {
  let held = null; // { byId: Map, list: [] }
  const stats = { full: 0, delta: 0 };

  const set = list => {
    const sorted = [...list].sort(order);
    held = { byId: new Map(sorted.map(r => [r.id, r])), list: sorted };
    return [...sorted];
  };

  async function full() {
    stats.full++;
    return set(await all());
  }

  async function load() {
    if (!held || !held.list.length) return full();
    const base = held;
    const newest = base.list[base.list.length - 1].createdAt;
    const from = new Date(Date.parse(newest) - overlapMs).toISOString();
    const [fresh, rows] = await Promise.all([since(from), count()]);
    const byId = new Map(base.byId);
    for (const r of fresh) byId.set(r.id, r);
    if (byId.size !== rows) return full();
    stats.delta++;
    return set([...byId.values()]);
  }

  return { load, stats: () => ({ ...stats, held: held ? held.list.length : 0 }) };
}

module.exports = { keptReflections, OVERLAP_MS };
