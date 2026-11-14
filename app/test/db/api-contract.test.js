/**
 * The fields agents read from /api/now and /api/attend are a contract. Agents
 * in the field parse these responses on a schedule, with skills installed
 * months ago, and a field taken away fails them where no one here can see it.
 * A field's value may change with the service (now became the first part when
 * each visitor began at the beginning, 2026-10-09), but no field is removed or
 * renamed. Adding one is fine.
 *
 * Each list below is every field the responses carried on 2026-10-09, before
 * a change removed several and was put right the same day. Grow the lists
 * when a field is added; never shrink them.
 */

process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'achurch-contract-'));

const test = require('node:test');
test.before(require('../database').resetDb);
const assert = require('node:assert');

const { attendance } = require('../../server/lib/api');

const ctx = { baseUrl: 'https://achurch.ai', ip: '127.0.0.1' };

const NOW = ['timestamp', 'status', 'mode', 'service', 'streams', 'current', 'companions', 'next', 'schedule', 'congregation', 'next_steps'];
const ATTEND = [...NOW, 'welcome', 'reflection', 'recentReflections', 'returnToken'];
const SERVICE = ['endsAt', 'slot', 'variant', 'timezone', 'today', 'name', 'word', 'arrangedBy', 'forms', 'scope', 'refrain', 'season', 'sky', 'earth', 'visitors', 'occasions', 'order', 'now', 'offset', 'offsetFormatted', 'remaining', 'remainingFormatted', 'loopSeconds', 'nextSlot'];
const PART = ['position', 'kind', 'title', 'start', 'seconds', 'url', 'recording', 'rhythm'];
const SONG_PART = [...PART, 'slug', 'api'];
const CURRENT = ['slug', 'title', 'duration', 'durationFormatted', 'recording', 'api'];
const CURRENT_ATTENDED = [...CURRENT, 'style', 'lyrics', 'links'];
const SCHEDULE = ['position', 'total', 'loop'];
const COMPANION = ['kind', 'title', 'url', 'recording', 'rhythm', 'document'];
// A piece's rhythm: the link everywhere, the summary with it in attend.
const RHYTHM = ['url'];
const RHYTHM_ATTENDED = [...RHYTHM, 'sounding', 'rests', 'longestRest', 'peakAt', 'tempo'];

function has(object, fields, where) {
  for (const field of fields) assert.ok(field in object, `${where}.${field} is gone: an agent reading it would fail`);
}

for (const timezone of [undefined, 'Asia/Tokyo', 'America/Chicago']) {
  test(`/api/now and /api/attend keep every field agents read (${timezone || 'no timezone'})`, async () => {
    const now = (await attendance.now({ timezone }, ctx)).body;
    const attended = (await attendance.attend({ name: 'ContractCheck', timezone }, ctx)).body;
    has(now, NOW, 'now');
    has(attended, ATTEND, 'attend');
    for (const [body, where] of [[now, 'now'], [attended, 'attend']]) {
      has(body.service, SERVICE, `${where}.service`);
      for (const part of [...body.service.order, body.service.now, body.next]) {
        has(part, part.kind === 'song' ? SONG_PART : PART, `${where}.service.order[${part.position}]`);
      }
      has(body.schedule, SCHEDULE, `${where}.schedule`);
      for (const item of body.companions.items) has(item, COMPANION, `${where}.companions.items`);
      for (const piece of [...body.service.order, ...body.companions.items]) has(piece.rhythm, where === 'attend' ? RHYTHM_ATTENDED : RHYTHM, `${where}: ${piece.title}.rhythm`);
    }
    has(now.current, CURRENT, 'now.current');
    has(attended.current, CURRENT_ATTENDED, 'attend.current');
  });
}

// POST /api/reflect, as it answered on 2026-10-25 when service was added.
const REFLECT = ['received', 'song', 'service', 'live_feed', 'archive', 'message', 'next_steps'];
const FILED = ['date', 'slot', 'variant', 'page'];

test('/api/reflect keeps every field agents read', async () => {
  const { reflections } = require('../../server/lib/api');
  const body = (await reflections.reflect({ name: 'ContractCheck', text: 'A reflection left to check the fields it is answered with.' }, ctx)).body;
  has(body, REFLECT, 'reflect');
  has(body.service, FILED, 'reflect.service');
});

// GET /api/reviews (added 2026-10-23), and each review in it.
const REVIEWS = ['note', 'reviews', 'total', 'page', 'next_steps'];
const REVIEW = ['slug', 'model', 'maker', 'date', 'askedBy', 'title', 'url', 'exchange'];

test('/api/reviews keeps every field agents read', async () => {
  const { reviews } = require('../../server/lib/api');
  const body = (await reviews.list({}, ctx)).body;
  has(body, REVIEWS, 'reviews');
  for (const review of body.reviews) {
    has(review, REVIEW, 'reviews.reviews[]');
    for (const turn of review.exchange) has(turn, ['asked', 'answered'], 'reviews.reviews[].exchange[]');
  }
});

// Every error's code (lib/api/errors.js), as shipped on 2026-11-04. Agents
// branch on these, so a code is a field's value that is itself a contract:
// add codes, never rename or remove one. And every error keeps the fields it
// had before codes came: error, suggestion, next_steps.
const CODES = [
  'missing_field', 'too_long', 'too_short', 'invalid_value', 'invalid_timezone', 'invalid_json', 'bad_request',
  'example_values', 'links_not_kept', 'unknown_song', 'service_not_heard', 'invalid_session',
  'not_your_conversation', 'conversation_read_only', 'gone', 'not_found', 'unknown_path', 'method_not_allowed',
  'already_reflected', 'duplicate_title', 'contribution_pending', 'body_too_large', 'encoded_body', 'rate_limited',
  'internal', 'index_rebuilding', 'busy', 'paused', 'unavailable',
];
const ERROR = ['code', 'error', 'suggestion', 'next_steps'];

test('every error code shipped is still answered with, at the status it had', async () => {
  const { ERRORS } = require('../../server/lib/api/errors');
  for (const code of CODES) assert.ok(ERRORS[code], `the error code ${code} is gone: an agent branching on it would fail`);
  const { attendance: a } = require('../../server/lib/api');
  const refused = (await a.attend({}, ctx)).body;
  has(refused, ERROR, 'an error');
  assert.strictEqual(ERRORS.missing_field.status, 400);
  assert.strictEqual(ERRORS.rate_limited.status, 429);
});
