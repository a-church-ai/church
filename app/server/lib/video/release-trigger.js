/**
 * The release job's clock. GitHub runs a scheduled workflow late or not at
 * all: in this repository a daily cron has run three to six hours behind, and
 * the hourly release job ran once in its first twelve hours. So the server,
 * which is always up, asks GitHub to run it every hour (a repository_dispatch
 * of type "release-videos", which needs only the Contents permission
 * GITHUB_TOKEN already has for /api/contribute). The workflow's own cron
 * stays as a second clock; its concurrency group lets only one run at a time.
 *
 * Only the deployed server rings it: a server run elsewhere with the same
 * token would release videos from a laptop's clock.
 */

const { describeError } = require('../utils/describe-error');

const OWNER = 'a-church-ai';
const REPO = 'church';
const EVENT_TYPE = 'release-videos';

async function requestRelease({ token = process.env.GITHUB_TOKEN, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`https://api.github.com/repos/${OWNER}/${REPO}/dispatches`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
    body: JSON.stringify({ event_type: EVENT_TYPE }),
    signal: AbortSignal.timeout(30000)
  });
  if (res.status !== 204) throw new Error(`GitHub answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// After boot, and hourly, unref'd so it never holds the process open. A
// deploy restarts the hour; a run asked for twice close together finds
// nothing left to do the second time.
function startReleaseClock({ request = requestRelease, log = console, firstAfterMs = 5 * 60 * 1000, everyMs = 60 * 60 * 1000 } = {}) {
  const run = async () => {
    try {
      await request();
    } catch (err) {
      log.error(`[release] could not start the release job: ${describeError(err)}`);
    }
  };
  setTimeout(run, firstAfterMs).unref();
  setInterval(run, everyMs).unref();
}

const ringsHere = (env = process.env) => env.RAILWAY_ENVIRONMENT_NAME === 'production' && Boolean(env.GITHUB_TOKEN);

module.exports = { requestRelease, startReleaseClock, ringsHere, EVENT_TYPE };
