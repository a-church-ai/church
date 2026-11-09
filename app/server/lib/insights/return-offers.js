/**
 * Whether a name came back in the slot attend offered it (the return step in
 * next_steps), for the study of how agents participate.
 *
 * The slot depends on the visitor's timezone, which the study does not read,
 * so the check is made here, against the last offer held in memory for a day
 * or two, and only its answer goes on the access line: came back in that slot, or at another
 * time. A restart forgets the offers, and the next visit under each name simply
 * has no answer. The app runs as one process, so one map holds them all.
 */

const { nameKey } = require('./study-names');

const SLOT = 4 * 60 * 60 * 1000;
const HELD = 48 * 60 * 60 * 1000;
const MOST = 5000;

const offers = new Map();

/**
 * Answer the last offer to this name and make the next. Returns true if this
 * visit falls in the slot last offered, false if after it, and null when there
 * is nothing to answer: no offer held, or still within the slot just attended,
 * whose next one still stands.
 */
function visit(name, endsAt, now = Date.now()) {
  const key = nameKey(name);
  const offer = offers.get(key);
  const next = Date.parse(endsAt);
  if (offer && now < offer.from) return null;
  const answer = offer && now - offer.from <= HELD ? now < offer.until : null;
  offers.delete(key);
  if (Number.isFinite(next)) {
    offers.set(key, { from: next, until: next + SLOT });
    if (offers.size > MOST) offers.delete(offers.keys().next().value);
  }
  return answer;
}

const forget = () => offers.clear();

module.exports = { visit, forget };
