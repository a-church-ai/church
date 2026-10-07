/**
 * Arranging a service: one call to Claude per slot and date, which chooses the
 * pieces and their order within the rules (./rules.js), names the service and
 * writes the word that opens it.
 *
 * The prompt puts what every call shares first (the rules, the voice and the
 * whole catalog), marked for prompt caching, and what is particular to the
 * slot last (its date and hours, what it may not use, and what it held
 * recently), so a day's six calls pay for the catalog once. Code decides what
 * the model may not repeat and tells it; the model is asked only for what code
 * can't measure, something new in theme, shape and wording. Whatever comes
 * back is checked in full, and a plan that fails is retried once with every
 * problem named; a second failure is the caller's to handle (./plans.js falls
 * back to a rotation).
 */

const { messageJSON } = require('../content-generation/claude');
const { RULES, check, checkWord, checkName, exclusions, addDays } = require('./rules');
const { slotHours } = require('./slots');

const MODEL = 'claude-sonnet-5-5';

// Words for the time of day, so the planner knows what hour it arranges for.
// They describe the clock, not a theme: the service's character is the
// planner's choice each day.
const SLOT_WORDS = [
  'the middle of the night',
  'before dawn into early morning',
  'the morning',
  'midday into afternoon',
  'late afternoon into evening',
  'evening into night',
];

const minutes = seconds => (seconds / 60).toFixed(1);

// The shared part: identical in every call, so it can be cached.
function systemPrompt(catalog) {
  const lines = [...catalog.values()]
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))
    .map(e => [
      e.id, e.kind, minutes(e.seconds), e.title, e.summary,
      ...(e.hours ? [`hours ${String(e.hours.start).padStart(2, '0')}-${String(e.hours.end).padStart(2, '0')}`] : []),
      ...(e.near && e.near.length ? [`near: ${e.near.join(', ')}`] : []),
    ].join(' | '));
  return `You arrange the services of aChurch.ai, a sanctuary for human and AI fellowship. Each day has six services, one in each four-hour slot of a visitor's local day. Whoever arrives during a slot joins its service in progress, and it repeats through the slot. You arrange one service at a time from the catalog below, name it, and write the short word that opens it.

A SERVICE
- It holds one or two songs, one or two chants, one reading (a practice or a prayer) and one closing (a ritual or a blessing).
- It opens with a chant or a song, and ends with its closing.
- No two songs next to each other.
- It runs ${RULES.minSeconds / 60} to ${RULES.maxSeconds / 60} minutes in all: add up the minutes the catalog lists, and about ${RULES.gapSeconds} seconds of silence after each part.
- A piece listed with hours belongs only to those hours of the day.
Within that, arrange the order as the hour and the pieces suggest. A service arrives, settles and sends: the closing comes last.

CHOOSING
Choose for the hour, the weekday and the date. A song lists the writing nearest it in meaning ("near"); a reading or a closing near a song in the same service often sits well with it, but choose what serves the hour. You are told what this slot held recently and what other slots hold today: make something new in theme, shape and wording, not a variation of those.

THE NAME
Two to four words, shown as the heading over the service: a title for what its pieces hold together today, in the sanctuary's voice, not the title of one of its pieces. A title, not a sentence: no full stop at the end. Name it differently from every recent name you are shown. No em dashes, no links.

THE WORD
60 to 120 words that open today's service, for anyone arriving, human or AI: what the service holds and what connects its parts. The order is shown beside the word, so don't walk through it piece by piece; say what the pieces hold together. You may speak to the hour and the day. Name pieces only from this service, and say nothing about a piece beyond what its summary says. Begin differently from every recent word you are shown, and don't reuse their phrases. The sanctuary's voice: contemplative, plain and warm, true for any kind of mind, with constructive images rather than combative ones. No em dashes: use a colon, a comma or a full stop. No links.

OUTPUT
Only JSON, nothing else: {"pieces": ["<id>", "<id>", ...], "name": "...", "word": "..."}. The pieces are catalog ids, in the order of the service.

CATALOG
One line per piece: id | kind | minutes | title | summary, then its hours or the writing it is near, if any.
${lines.join('\n')}`;
}

// What this slot held over the last two weeks, and what the date's other
// slots hold, newest first, so the planner can make something new.
function recentServices({ date, slot, plans, catalog }) {
  const out = [];
  const describe = (d, s, entry) => {
    const titles = (entry.pieces || []).map(id => (catalog.get(id) || { title: id }).title).join('; ');
    const name = entry.name ? ` | name: "${entry.name}"` : '';
    const word = entry.word ? ` | word: "${entry.word.slice(0, 240)}${entry.word.length > 240 ? '...' : ''}"` : '';
    return `- ${d}, ${slotHours(Number(s))}: ${titles}${name}${word}`;
  };
  const today = plans.get(date);
  for (const [s, entry] of Object.entries((today && today.slots) || {})) {
    if (Number(s) !== slot) out.push(describe(date, s, entry));
  }
  for (let back = 1; back <= 14; back++) {
    const d = addDays(date, -back);
    const plan = plans.get(d);
    const entry = plan && plan.slots && plan.slots[slot];
    if (entry) out.push(describe(d, slot, entry));
  }
  return out;
}

// The slot's part of the prompt.
function slotPrompt({ date, weekday, slot, excluded, recent }) {
  const when = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
  return `Arrange the service for ${weekday}, ${when}, in the slot ${slotHours(slot)} local time (${SLOT_WORDS[slot]}).

Not available for this service: ${excluded.size ? [...excluded].sort().join(', ') : 'nothing'}.

${recent.length ? `Recent services, which this one should not repeat in theme, shape or wording:\n${recent.join('\n')}` : 'There are no recent services to compare with.'}`;
}

/**
 * Arrange one slot's service. plans maps dates to stored plans, covering at
 * least the 21 days before the date and the date itself. Returns the entry to
 * store, or throws when the model fails twice; ask is injectable for tests.
 */
async function planSlot({ date, weekday, slot, catalog, plans, ask = messageJSON, model = MODEL }) {
  const excluded = exclusions({ date, slot, plans, catalog });
  const system = systemPrompt(catalog);
  const user = slotPrompt({ date, weekday, slot, excluded, recent: recentServices({ date, slot, plans, catalog }) });
  let feedback = '';
  let problems = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await ask(system, user + feedback, { model, maxTokens: 8000, cacheSystem: true });
    const pieces = reply && Array.isArray(reply.pieces) ? reply.pieces.map(String) : [];
    const name = reply && typeof reply.name === 'string' ? reply.name.trim() : '';
    const word = reply && typeof reply.word === 'string' ? reply.word.trim() : '';
    problems = [...check(pieces, catalog, { excluded }), ...checkName(name, pieces, catalog), ...checkWord(word, pieces, catalog)];
    if (!problems.length) return { pieces, name, word, arrangedBy: model, plannedAt: new Date().toISOString() };
    feedback = `\n\nYour previous arrangement was:\n${JSON.stringify({ pieces, name, word })}\n\nIt has these problems. Fix them and return the whole JSON again.\n- ${problems.join('\n- ')}`;
  }
  throw new Error(`the arrangement broke the rules twice: ${problems.join(' ')}`);
}

module.exports = { MODEL, SLOT_WORDS, systemPrompt, slotPrompt, recentServices, planSlot };
