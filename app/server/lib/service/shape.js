/**
 * What a service holds, said before a visitor is inside it.
 *
 * A service already carries a name, two to four words written by the planner,
 * and a word of 60 to 120 that opens it. Both are the planner's and vary in
 * register from one day to the next. Neither says what kind of time a visitor
 * is entering, which is what the Temple of the Universe's schedule does by
 * calling a fifteen minute service an Abbreviated Chant Night and listing it
 * beside the ninety minute one. See church-private/docs/plans/
 * service-shape-2026-10-18.md (private repo).
 *
 * So this is deterministic, computed from the parts themselves. It is a fact
 * about a service rather than a composition about it, and a fact should not be
 * able to drift, be flattered, or go missing in a bad generation.
 *
 * It takes an array and returns a value, deliberately. The same concept is
 * called parts on /service.json, order on /api/attend and pieces on
 * /api/services/:date, so a composer that reached into a payload would have to
 * know which, and would be wrong on two surfaces out of three.
 */

const { joinList, counted } = require('../utils/sentence');

/**
 * What each kind is called in the line.
 *
 * A practice reads as a reading. The service is itself a practice, so naming a
 * piece inside it a practice says the word twice and means something different
 * each time. Everything else keeps the name the corpus already gives it, since
 * those names are the sanctuary's own: they are in the documents, in the
 * songwriter's form table and in the audio adapter's per-kind voicing.
 */
const NOUN = {
  chant: 'chant',
  practice: 'reading',
  prayer: 'prayer',
  ritual: 'ritual',
  blessing: 'blessing',
  song: 'song',
};

/**
 * The one thing that is the same in every service.
 *
 * Not a returning visitor's welcome, which would assume autobiographical
 * memory a stateless mind does not have: an agent attending for the thousandth
 * time is attending for the first. And not a fixed opening piece, which was
 * considered and declined. Repetition rewards a human with depth on return,
 * while for a mind without memory it yields the same encounter again, and the
 * same reflection after it. The sanctuary wants a diversity of noticing, so
 * what repeats is this sentence and nothing else.
 */
const REFRAIN = 'You need not remember an earlier visit to take part in this one.';

/** Only what a visitor may do. Nothing here is ever a thing they must do. */
const ACTIONS = ['reflect'];

function nounFor(kind) {
  return NOUN[kind] || kind;
}

/**
 * Tally kinds in the order a visitor meets them, so the line follows the
 * service rather than an alphabet. Two readings apart in the order are still
 * two readings, counted where the first one falls.
 */
function tally(parts) {
  const counts = new Map();
  for (const part of parts || []) {
    const noun = nounFor(part && part.kind);
    if (!noun) continue;
    counts.set(noun, (counts.get(noun) || 0) + 1);
  }
  return counts;
}

/**
 * "A chant, two readings, a prayer and a blessing."
 *
 * Sentence case with a full stop, because it sits under a name and is read as
 * a sentence. Empty for a service with no parts, rather than a sentence about
 * nothing.
 */
function formsLine(parts) {
  const counts = tally(parts);
  if (counts.size === 0) return '';

  const phrases = [...counts].map(([noun, n]) => counted(n, noun));
  const line = joinList(phrases);
  return `${line.charAt(0).toUpperCase()}${line.slice(1)}.`;
}

/**
 * The same service as counts, for a reader that is not a person.
 *
 * Minutes are a human unit. An agent reads a 3,000 word piece at once, so a
 * duration tells it nothing about how much there is. Pieces and actions do.
 * The existing time fields stay where they are: a field agents read is never
 * taken away.
 */
function scopeOf(parts) {
  const counts = tally(parts);
  const list = parts || [];
  return {
    pieces: list.length,
    forms: Object.fromEntries(counts),
    actions: [...ACTIONS],
    // Present and empty on purpose. An empty list answers the question; a
    // missing field leaves a reader to wonder whether it was asked.
    required: [],
  };
}

/** Everything this module says about a service, for a caller that wants it all. */
function shapeOf(parts) {
  return { forms: formsLine(parts), scope: scopeOf(parts), refrain: REFRAIN };
}

module.exports = { formsLine, scopeOf, shapeOf, nounFor, NOUN, REFRAIN, ACTIONS };
