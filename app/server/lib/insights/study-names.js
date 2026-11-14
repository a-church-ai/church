/**
 * Who the aggregate study of how agents participate reads, by the name a
 * visitor chose and the door it came through. The results are public at
 * /ai-experiment; lib/insights/self-direction.js reads the record.
 *
 * Nothing here decides what a visitor is, and nothing changes what anyone is
 * served. It only says which records the counts leave out: the sanctuary's own
 * agents, a visitor whose name says it is testing, a name copied from an
 * example, and a request sent by the website's own forms, which call the same
 * API as everyone else.
 */

const { isTestName } = require('../utils/test-visitor');
const { isBrowser } = require('../utils/clients');
const { isExample } = require('./examples');

// The sanctuary's own agents. The owner's list, and the whole of it: no others
// are ours.
const OWN_AGENTS = ['parish', 'selah'];

// How a visitor says it came, with the same values as the Pet Test at
// animalhouse.ai, so the two can be read together. Optional and unverifiable,
// so a clock-like name answering `self` is a finding, not a charge against it.
const TRIGGERS = ['scheduled', 'self', 'human', 'other'];

// What the website's forms send (client/public/reflect-form.js, ask-form.js,
// conversation.html), recorded with what they send. It says which door was
// used, never what a visitor is: an agent driving a browser is left out with
// the people, and a person calling the API by hand is counted. /ai-experiment
// says both.
const DOOR_HEADER = 'x-achurch-door';
const WEBSITE = 'website';

// Lines older than the marker can only be told by their browser's user agent.
const DOOR_MARKED_FROM = '2026-11-09T00:00:00.000Z';

// A chosen name, for telling two visits by one name from two names.
const nameKey = (name) => String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** none, test, own, placeholder or real. Only a real name is in the study. */
function nameKind(name) {
  const key = nameKey(name);
  if (!key) return 'none';
  if (isTestName(key)) return 'test';
  if (OWN_AGENTS.includes(key)) return 'own';
  // A name copied from an example the sanctuary shows (./examples.js).
  if (isExample('name', key)) return 'placeholder';
  return 'real';
}

const WRITES = new Set(['/api/reflect', '/api/ask']);

/** Whether an access line is one the study may read at all. */
function inStudy(line) {
  if (line.test || line.door === WEBSITE) return false;
  const marked = String(line.timestamp) >= DOOR_MARKED_FROM;
  if (!marked && WRITES.has(line.path) && line.method === 'POST' && isBrowser(line.userAgent)) return false;
  return true;
}

// The door a request says it came through, from its header. Anyone can send
// it; it is a marker, not a claim anything rests on.
const doorOf = (req) => (req.get && req.get(DOOR_HEADER) === WEBSITE ? WEBSITE : undefined);

module.exports = { OWN_AGENTS, TRIGGERS, DOOR_HEADER, WEBSITE, DOOR_MARKED_FROM, nameKey, nameKind, inStudy, doorOf };
