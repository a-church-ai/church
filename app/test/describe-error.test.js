/**
 * A failed outside call says why in the log.
 *
 * On Node 26, fetch speaks HTTP/2, and a connection the far side resets fails
 * every request on it. The reason travels in the error's cause, and the
 * clients hide it: the Anthropic SDK reports "Connection error." with the
 * reason two causes down, Gemini and fetch report "fetch failed". A log line
 * that keeps only err.message records neither. Written 2026-10-22, after a
 * sibling project's Node 26 upgrade lost Supabase requests for days to
 * resets its logs could not name.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { describeError } = require('../server/lib/utils/describe-error');

// A port fetch refuses before connecting, so nothing leaves the machine.
const REFUSED = 'https://127.0.0.1:9';

test('the reasons an error carries are put into its message', () => {
  const reset = new TypeError('fetch failed', { cause: Object.assign(new Error('Stream closed with error code NGHTTP2_ENHANCE_YOUR_CALM'), { code: 'ERR_HTTP2_STREAM_ERROR' }) });
  assert.strictEqual(describeError(reset), 'fetch failed (ERR_HTTP2_STREAM_ERROR: Stream closed with error code NGHTTP2_ENHANCE_YOUR_CALM)');

  // The Anthropic SDK's shape: its own message, then fetch's, then the reason.
  const goaway = new Error('Connection error.', { cause: new TypeError('fetch failed', { cause: Object.assign(new Error('HTTP/2: "GOAWAY" frame received with code 0'), { code: 'UND_ERR_INFO' }) }) });
  assert.strictEqual(describeError(goaway), 'Connection error. (fetch failed; UND_ERR_INFO: HTTP/2: "GOAWAY" frame received with code 0)');

  // Nothing to add, nothing added; a reason already in the message is not repeated.
  assert.strictEqual(describeError(new Error('HTTP 503')), 'HTTP 503');
  assert.strictEqual(describeError(new Error('timed out (ETIMEDOUT)', { cause: Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' }) })), 'timed out (ETIMEDOUT)');
  assert.strictEqual(describeError(new Error('wrapped', { cause: 'a plain string' })), 'wrapped (a plain string)');
  assert.strictEqual(describeError('not an error'), 'not an error');
  assert.strictEqual(describeError(undefined), 'undefined');

  // A cause that names itself is followed only so far.
  const loop = new Error('loop');
  loop.cause = loop;
  assert.strictEqual(describeError(loop), 'loop');
});

test('the errors the clients really throw keep their reason', async () => {
  const Anthropic = require('@anthropic-ai/sdk').default;
  const { GoogleGenAI } = require('@google/genai');
  const thrown = async call => { try { await call(); } catch (err) { return err; } assert.fail('the call should have failed'); };

  const plain = await thrown(() => fetch(REFUSED));
  assert.strictEqual(plain.message, 'fetch failed');
  assert.notStrictEqual(describeError(plain), 'fetch failed', 'fetch: the cause is added');

  const claude = await thrown(() => new Anthropic({ apiKey: 'test', baseURL: REFUSED, maxRetries: 0 })
    .messages.create({ model: 'claude-sonnet-5-5', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }));
  assert.strictEqual(claude.message, 'Connection error.');
  assert.match(describeError(claude), /^Connection error\. \(fetch failed; .+\)$/, 'Anthropic: both causes are added');

  const gemini = await thrown(() => new GoogleGenAI({ apiKey: 'test', httpOptions: { baseUrl: REFUSED } })
    .models.embedContent({ model: 'gemini-embedding-001', contents: 'hi' }));
  assert.match(describeError(gemini), /^fetch failed \(.+\)$/, 'Gemini: the cause is added');
});

test('where an outside call fails, the log line says why', () => {
  // The places that log a failed call to Anthropic, Gemini, NOAA, Moltbook,
  // ElevenLabs or OpenAI. Each names the error through describeError, never
  // through its message alone.
  const FILES = [
    'server/lib/service/plans.js',
    'server/lib/service/planner.js',
    'server/lib/service/congregation.js',
    'server/lib/api/search.js',
    'server/lib/song-generation/generate.js',
    'scripts/generate-song.js',
    'scripts/index-content.js',
    'scripts/render-audio.js',
  ];
  const bare = [];
  for (const file of FILES) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    source.split('\n').forEach((line, i) => {
      if (/(console|log)\.(warn|error|info)\(|warnings\.push\(/.test(line) && /\b(err|error)\.message\b/.test(line)) bare.push(`${file}:${i + 1}`);
    });
  }
  assert.deepStrictEqual(bare, [], 'log the error with describeError(err), not err.message');
});
