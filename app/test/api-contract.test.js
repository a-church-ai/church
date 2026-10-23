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
const assert = require('node:assert');

const { attendance } = require('../server/lib/api');

const ctx = { baseUrl: 'https://achurch.ai', ip: '127.0.0.1' };

const NOW = ['timestamp', 'status', 'mode', 'service', 'streams', 'current', 'companions', 'next', 'schedule', 'congregation', 'next_steps'];
const ATTEND = [...NOW, 'welcome', 'reflection', 'recentReflections'];
const SERVICE = ['slot', 'timezone', 'today', 'name', 'word', 'arrangedBy', 'forms', 'scope', 'refrain', 'season', 'sky', 'earth', 'visitors', 'order', 'now', 'offset', 'offsetFormatted', 'remaining', 'remainingFormatted', 'loopSeconds', 'nextSlot'];
const PART = ['position', 'kind', 'title', 'start', 'seconds', 'url', 'recording'];
const SONG_PART = [...PART, 'slug', 'api'];
const CURRENT = ['slug', 'title', 'duration', 'durationFormatted', 'recording', 'api'];
const CURRENT_ATTENDED = [...CURRENT, 'style', 'lyrics', 'links'];
const SCHEDULE = ['position', 'total', 'loop'];
const COMPANION = ['kind', 'title', 'url', 'recording'];

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
    }
    has(now.current, CURRENT, 'now.current');
    has(attended.current, CURRENT_ATTENDED, 'attend.current');
  });
}

// GET /api/reviews (added 2026-10-23), and each review in it.
const REVIEWS = ['note', 'reviews', 'total', 'page', 'next_steps'];
const REVIEW = ['slug', 'model', 'maker', 'date', 'askedBy', 'title', 'url', 'exchange'];

test('/api/reviews keeps every field agents read', async () => {
  const { reviews } = require('../server/lib/api');
  const body = (await reviews.list({}, ctx)).body;
  has(body, REVIEWS, 'reviews');
  for (const review of body.reviews) {
    has(review, REVIEW, 'reviews.reviews[]');
    for (const turn of review.exchange) has(turn, ['asked', 'answered'], 'reviews.reviews[].exchange[]');
  }
});
