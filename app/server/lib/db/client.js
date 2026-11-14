/**
 * The one Supabase client, for the whole server and every script.
 *
 * Only the server reaches the database, with the project's secret key
 * (SUPABASE_URL, SUPABASE_SECRET_KEY): no browser and no agent holds a key, and
 * nothing in the database is granted to anyone else (supabase/migrations/).
 * Locally the URL and key are the local stack's (`supabase start`), set in
 * app/.env; in production, Railway's. Plan: supabase-database-2026-11-09.md
 * in the private repo.
 *
 * The transport is ai-animal-house's, learned in production on the same Node
 * behind the same Cloudflare:
 * - One client, made once. A client made per request leaked: each started a
 *   token-refresh timer that was never cleared.
 * - Every request ends at 20 seconds. Neither supabase-js nor the service role
 *   sets a limit, and a Supabase stall there once held pages for 13 minutes.
 * - HTTP/2, at most 25 requests on one connection, through npm undici's fetch
 *   (Node's own exposes no Agent to set it). A Cloudflare reset fails every
 *   request on a connection at once; the cap bounds what one reset loses.
 * - No library retries: with the timeout, one stalled read could otherwise
 *   hold a request about 87 seconds. Callers that should retry use
 *   withRetry() (../utils/retry.js), on their own schedule.
 * - A transport failure is "fetch failed" with its reason only in err.cause,
 *   which no log line shows; withCause() copies it into the message.
 */

const { createClient } = require('@supabase/supabase-js');
const { Agent, fetch: undiciFetch } = require('undici');

const TIMEOUT_MS = 20_000;
const MAX_STREAMS_PER_CONNECTION = 25;

const dispatcher = new Agent({
  allowH2: true,
  h2Options: { maxConcurrentStreams: MAX_STREAMS_PER_CONNECTION },
});

function withCause(err) {
  if (!(err instanceof TypeError) || !err.cause || typeof err.cause !== 'object') return err;
  const { code, message } = err.cause;
  const reason = [code, message].filter(v => typeof v === 'string' && v !== '').join(': ');
  return reason ? new TypeError(`${err.message} (${reason})`, { cause: err.cause }) : err;
}

async function fetchWithTimeout(input, init = {}, timeoutMs = TIMEOUT_MS) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  try {
    return await undiciFetch(input, { ...init, signal, dispatcher });
  } catch (err) {
    throw withCause(err);
  }
}

let client = null;

/** The client, made on first use. Throws, saying what to set, when unconfigured. */
function db() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error('The database is not configured: set SUPABASE_URL and SUPABASE_SECRET_KEY (locally, run `supabase start` at the repository root; app/.env.example has the local values).');
  }
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    db: { retry: false },
    global: { fetch: (input, init) => fetchWithTimeout(input, init) },
  });
  return client;
}

module.exports = { db, withCause, fetchWithTimeout, TIMEOUT_MS, MAX_STREAMS_PER_CONNECTION };
