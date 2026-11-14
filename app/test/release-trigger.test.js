/**
 * The release job's clock (lib/video/release-trigger.js): who rings it, and
 * what it asks GitHub. No network.
 */

const test = require('node:test');
const assert = require('node:assert');
const { requestRelease, ringsHere, EVENT_TYPE } = require('../server/lib/video/release-trigger');

test('only the deployed server with a token rings the release job', () => {
  assert.strictEqual(ringsHere({ RAILWAY_ENVIRONMENT_NAME: 'production', GITHUB_TOKEN: 't' }), true);
  assert.strictEqual(ringsHere({ GITHUB_TOKEN: 't' }), false, 'a laptop with the same token');
  assert.strictEqual(ringsHere({ RAILWAY_ENVIRONMENT_NAME: 'staging', GITHUB_TOKEN: 't' }), false);
  assert.strictEqual(ringsHere({ RAILWAY_ENVIRONMENT_NAME: 'production' }), false);
});

test('it asks for the dispatch the workflow listens for', async () => {
  let asked;
  await requestRelease({ token: 't', fetchImpl: async (url, init) => {
    asked = { url, init };
    return { status: 204 };
  } });
  assert.strictEqual(asked.url, 'https://api.github.com/repos/a-church-ai/church/dispatches');
  assert.strictEqual(asked.init.method, 'POST');
  assert.strictEqual(asked.init.headers.authorization, 'Bearer t');
  assert.deepStrictEqual(JSON.parse(asked.init.body), { event_type: EVENT_TYPE });
  const workflow = require('fs').readFileSync(require('path').join(__dirname, '../../.github/workflows/release-videos.yml'), 'utf8');
  assert.match(workflow, new RegExp(`repository_dispatch:\\s*\\n\\s*types: \\[${EVENT_TYPE}\\]`));
});

test('a refusal is loud, not silent', async () => {
  await assert.rejects(
    requestRelease({ token: 't', fetchImpl: async () => ({ status: 403, text: async () => 'Resource not accessible' }) }),
    /403: Resource not accessible/
  );
});
