/**
 * Every error the API answers with, by code: its status, and how long a
 * client should wait before trying again when waiting helps.
 *
 * A code names a kind of answer, not a field: which field went wrong is in
 * `details` ([{ field, message, limit? }]). Clients branch on `code`; `error`
 * is the sentence for reading, and may be reworded. Both are part of the
 * API's contract (test/api-contract.test.js): a code, once shipped, is never
 * renamed or removed. New ones may be added.
 *
 * Retry-After is sent from here (routes/api.js serve), by code, so the header
 * says what the body says: a service paused until a person renews its
 * account sends none, since no wait brings it back.
 *
 * Plan: church-private/docs/plans/api-one-source-2026-11-04.md (private repo).
 */

const ERRORS = {
  // The request, as sent.
  missing_field: { status: 400, description: 'A required field was not sent; details names it.' },
  too_long: { status: 400, description: 'A field is longer than its limit; details names it and the limit.' },
  too_short: { status: 400, description: 'A field is shorter than its minimum; details names it and the minimum.' },
  invalid_value: { status: 400, description: 'A field is not a value it can take: not text, not one of its allowed values, or not in its form; details names it.' },
  invalid_timezone: { status: 400, description: 'The timezone is not an IANA name the runtime recognizes, such as America/New_York.' },
  invalid_json: { status: 400, description: 'The body is not valid JSON.' },
  bad_request: { status: 400, description: 'The request could not be read as sent.' },
  example_values: { status: 400, description: 'A field is still the example from the documentation; nothing was submitted.' },
  links_not_kept: { status: 400, description: 'A reflection holds a web address; reflections are kept without links.' },
  unknown_song: { status: 400, description: 'songSlug names no song in the catalog.' },
  service_not_heard: { status: 400, description: 'The service named is not being heard anywhere now, or is not named in the form attend gives; omit it to reflect on the service for your timezone.' },
  invalid_session: { status: 400, description: 'session_id names no conversation.' },
  // Who may do what.
  not_your_conversation: { status: 403, description: 'The conversation can be continued only with the owner_token its first answer gave.' },
  conversation_read_only: { status: 403, description: 'The conversation was begun before conversations had owners, and takes no new questions.' },
  // What is asked for.
  gone: { status: 410, description: 'Something was here and will not be again.' },
  not_found: { status: 404, description: 'Nothing is at that address: no such song, lyrics, context, conversation, document or day of services.' },
  unknown_path: { status: 404, description: 'No endpoint has that path; the body names the nearest.' },
  method_not_allowed: { status: 405, description: 'That method is not taken at this path.' },
  already_reflected: { status: 409, description: 'The same words from the same name within 30 days: it is kept already.' },
  duplicate_title: { status: 409, description: 'A contribution with this title already exists in this category.' },
  contribution_pending: { status: 409, description: 'A pull request for this contribution may already be open.' },
  body_too_large: { status: 413, description: 'The body is larger than the server reads.' },
  encoded_body: { status: 415, description: 'The body was sent compressed; send it uncompressed.' },
  rate_limited: { status: 429, retryAfter: 3600, description: 'Over an hourly limit. Every limit here is per hour.' },
  // The sanctuary's side.
  internal: { status: 500, description: 'Something failed here. Not the caller\'s fault; trying again in a moment may work.' },
  index_rebuilding: { status: 503, retryAfter: 60, description: 'The search index is being rebuilt; try again shortly.' },
  busy: { status: 503, retryAfter: 30, description: 'A service this depends on is busy for a moment.' },
  paused: { status: 503, description: 'A service this depends on is paused until its account is renewed, which a person must do. No wait brings it back, so no Retry-After is sent.' },
  unavailable: { status: 503, description: 'This feature is offline here for now, with no known time of return.' },
};

const CODES = Object.keys(ERRORS);

/**
 * An error answer: { status, body }, the shape every operation returns.
 * error, suggestion and next_steps are required, so no answer goes without
 * what A6 of the readiness standard asks of every response; anything else
 * (details, allowed, example, existingPr, hint, retryAfter) is passed through.
 */
function refuse(code, { error, suggestion, next_steps, ...rest }) {
  const entry = ERRORS[code];
  if (!entry) throw new Error(`refuse: no such error code "${code}"`);
  if (!error || !suggestion || !Array.isArray(next_steps)) {
    throw new Error(`refuse(${code}): error, suggestion and next_steps are all required`);
  }
  return { status: entry.status, body: { code, error, suggestion, ...rest, next_steps } };
}

// The Retry-After for an answer, in seconds, or null when none is honest.
function retryAfterFor(body) {
  const entry = body && ERRORS[body.code];
  return entry && entry.retryAfter ? entry.retryAfter : null;
}

module.exports = { ERRORS, CODES, refuse, retryAfterFor };
