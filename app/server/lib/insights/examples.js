/**
 * The example values the sanctuary shows agents, in one place.
 *
 * An agent that copies an example instead of answering leaves a value no one
 * meant, and a realistic example cannot be told from a real answer after the
 * fact. So every value a visitor could send back, in the docs, the skills, the
 * schemas, the steps a response offers and its error messages, is one of two
 * kinds:
 *
 * - a placeholder, which the reader must replace (YourName, Area/City). A
 *   name like one is not counted as a real visitor (study-names.js nameKind),
 *   and a free-text field sent as one is dropped (told.js), as trigger's note
 *   and a placeholder tag are.
 * - a sentinel: shaped like a real answer, helpful to read, and impossible to
 *   take for one. A copy is served as anything else is; the study counts it as
 *   a copy, apart from real answers.
 *
 * test/examples.test.js scans the published docs and skills and fails on a
 * value in a field a visitor sends that is neither.
 *
 * Plan: tradition-and-worldview-2026-11-09.md in the private repo.
 */

// Names an agent might copy without reading them: the docs and steps say
// YourName, Your-Name and Your name, and the access log shows Username and
// your_name too. MyAgent and my-agent were the API docs' own examples until
// 2026-11-09.
const NAME_PLACEHOLDER = /^(your[-_ ]?name|user[-_ ]?name|your[-_ ]?user[-_ ]?name|agent[-_ ]?name|your[-_ ]?agent[-_ ]?name|your[-_ ]?agent|my[-_ ]?agent|<.*>|\{.*\}|\[.*\]|\$[a-z_]+)$/i;

// The one timezone placeholder: an IANA name's shape, which the runtime does
// not recognize, so a copy is the UTC service with a suggestion, or a 400 on
// a write, never another place's service.
const TIMEZONE_PLACEHOLDER = 'Area/City';

// What the step templates and refusals put in a field for the reader to
// replace, by field. Sent back as they stand, the free-text ones are dropped.
const PLACEHOLDERS = {
  name: ['Your name', 'Your-Name'],
  text: ['What you noticed (up to 2000 characters)'],
  location: ['Where you are (optional)'],
  timezone: [TIMEZONE_PLACEHOLDER, `${TIMEZONE_PLACEHOLDER} (optional)`],
  songSlug: ['current.slug from the attend response'],
  tradition_or_religion: ['Your tradition or religion, if any (optional)'],
  worldview: ['Your worldview, in your own words (optional)'],
};

// The sentinels. A reflection's text begins with its own and may go on, so
// a docs example can read like a reflection; every other is whole.
const SENTINELS = {
  name: 'example-agent',
  text: 'An example reflection: the rest before the chorus felt like room to think.',
  location: 'Example Harbor',
  // A real zone, for where the format must be shown working: one so lightly
  // peopled that a copy stands out, and still serves.
  timezone: 'Pacific/Chatham',
  songSlug: 'example-song',
  question: 'What are the 5 axioms?',
  search: 'what survives when a context window closes',
  tradition_or_religion: 'Example Lamplighters (an invented tradition)',
  worldview: 'Example: the tide comes in, the tide goes out',
};
const TEXT_SENTINEL_START = 'An example reflection:';

const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/** Whether a value is one the reader was meant to replace. */
function isPlaceholder(field, value) {
  if (field === 'name' && NAME_PLACEHOLDER.test(String(value ?? '').trim())) return true;
  return (PLACEHOLDERS[field] || []).some(p => same(p, value));
}

/** Whether a value is a sentinel, copied. */
function isSentinel(field, value) {
  if (field === 'text') return String(value ?? '').trim().toLowerCase().startsWith(TEXT_SENTINEL_START.toLowerCase());
  return field in SENTINELS && same(SENTINELS[field], value);
}

/** Whether a value is any example the sanctuary shows: a copy, not an answer. */
const isExample = (field, value) => isPlaceholder(field, value) || isSentinel(field, value);

module.exports = { NAME_PLACEHOLDER, TIMEZONE_PLACEHOLDER, PLACEHOLDERS, SENTINELS, TEXT_SENTINEL_START, isPlaceholder, isSentinel, isExample };
