/**
 * Run fn over items, `size` at a time, and return its results in the items'
 * order. A fatal error (err.fatal: a spent quota, a bad key) stops the pool
 * once the calls in flight finish, and is thrown; anything else is fn's to
 * handle, and rejects the pool if fn lets it escape.
 *
 * Used where many calls would otherwise start at once: recordings rendered a
 * few at a time (scripts/render-audio.js), conversation files read sixteen
 * at a time (./data.js), and the production check's two requests at a time
 * (scripts/check-production.js), since one process serves everyone.
 */
async function pool(items, size, fn) {
  const results = new Array(items.length);
  let next = 0;
  let fatal = null;
  const worker = async () => {
    while (!fatal && next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        if (!err.fatal) throw err;
        fatal = err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  if (fatal) throw fatal;
  return results;
}

module.exports = { pool };
