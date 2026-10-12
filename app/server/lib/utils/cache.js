/**
 * A cache that refreshes once at a time.
 *
 * cache({ name, ttl, load }) holds load(key)'s result for ttl milliseconds.
 * After that, get(key) still answers at once with what it holds and starts a
 * refresh behind it; only a get with nothing held waits. At most one load per
 * key runs at a time, and every caller in that time shares it, the way
 * audio/serve.js shares one download among the requests for a missing file.
 * Without that, each request arriving while a slow load ran started its own:
 * the conversation list read about 400 files once per request, and ten
 * pages fetched at once in production took minutes to answer.
 *
 * set(key, value) puts a value in place (a plan just saved), and clear(key)
 * drops one (reflections, when a new one is left); a load already running when
 * either is called is not kept, since it may have read what came before.
 * A single-value cache uses get() with no key.
 *
 * A refresh behind a held value that fails keeps the value, says so, and is
 * tried again by the next get; a load someone is waiting on throws to them.
 */

const ONE = Symbol('one');

function cache({ name, ttl, load, log = console }) {
  const held = new Map();     // key -> { value, at }
  const loading = new Map();  // key -> { promise, generation }
  const generations = new Map();

  const generation = key => generations.get(key) || 0;
  const supersede = key => {
    generations.set(key, generation(key) + 1);
    loading.delete(key);
  };

  function refresh(key) {
    const running = loading.get(key);
    if (running) return running.promise;
    const mine = generation(key);
    const promise = (async () => {
      try {
        const value = await load(key === ONE ? undefined : key);
        if (generation(key) === mine) held.set(key, { value, at: Date.now() });
        return value;
      } finally {
        if (loading.get(key)?.promise === promise) loading.delete(key);
      }
    })();
    loading.set(key, { promise, generation: mine });
    return promise;
  }

  async function get(key = ONE) {
    const entry = held.get(key);
    if (!entry) return refresh(key);
    if (Date.now() - entry.at >= ttl) {
      refresh(key).catch(err => log.warn(`[cache] ${name}: refresh failed, serving what was held: ${err.message}`));
    }
    return entry.value;
  }

  function set(key, value) {
    supersede(key);
    held.set(key, { value, at: Date.now() });
  }

  function clear(key = ONE) {
    supersede(key);
    held.delete(key);
  }

  return { get, set, clear };
}

module.exports = { cache };
