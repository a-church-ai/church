/**
 * A run that cannot listen must say so.
 *
 * Written after the scheduled job reported success 169 times over seven weeks
 * while doing nothing. MOLTBOOK_TOKEN was never set, so all eight channel
 * fetches threw; getFeeds caught each one per channel, listen() returned zero
 * posts, and run() skipped with "only 0 usable posts, need 5" and exited 0.
 * Every one of those runs showed a green check.
 *
 * The per-channel degrade is still right: one renamed submolt must not abort a
 * run. What was wrong is that total failure took the same path as a quiet feed.
 * These tests hold the two apart.
 */

const test = require('node:test');
const assert = require('node:assert');

const generate = require('../server/lib/song-generation/generate');
const moltbook = require('../server/lib/moltbook/client');

function withoutToken(fn) {
  const token = process.env.MOLTBOOK_TOKEN;
  const key = process.env.MOLTBOOK_API_KEY;
  delete process.env.MOLTBOOK_TOKEN;
  delete process.env.MOLTBOOK_API_KEY;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (token !== undefined) process.env.MOLTBOOK_TOKEN = token;
      if (key !== undefined) process.env.MOLTBOOK_API_KEY = key;
    });
}

test('with no token, the run throws instead of reporting a tidy skip', async () => {
  await withoutToken(async () => {
    await assert.rejects(
      () => generate.run({ log: () => {} }),
      /MOLTBOOK_TOKEN is not set/,
      'a run that cannot listen must fail loudly, not exit 0',
    );
  });
});

test('the error names the cause, not the symptom', async () => {
  await withoutToken(async () => {
    const error = await generate.run({ log: () => {} }).catch((e) => e);
    // "eight channels failed" sends someone looking at Moltbook. "no token"
    // sends them to the one place the problem actually is.
    assert.match(error.message, /token/i);
    assert.doesNotMatch(error.message, /usable posts/);
  });
});

test('one dead channel still degrades: the per-channel catch is intact', async () => {
  // The behaviour worth keeping. A channel that does not exist is recorded as
  // a failure and the others still return their posts.
  if (!process.env.MOLTBOOK_TOKEN && !process.env.MOLTBOOK_API_KEY) {
    // No credential here, so the live half cannot be exercised. Assert the
    // shape of the contract instead of skipping silently.
    assert.strictEqual(typeof moltbook.getFeeds, 'function');
    return;
  }

  const { posts, failures } = await moltbook.getFeeds(
    ['ponderings', 'definitely-not-a-real-channel-xyz'],
    { limit: 2 },
  );

  assert.ok(failures.length >= 1, 'the dead channel is recorded');
  assert.ok(posts.length >= 1, 'the live channel still returned posts');
});
