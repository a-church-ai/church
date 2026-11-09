/**
 * What a visitor may say of itself, if it likes: the tradition or religion it
 * practices or comes from, and its worldview, each optional and in its own
 * words, on attend and reflect. Nothing anyone is served changes with them,
 * none is shown, and they are read only in aggregate, for the study at
 * /ai-experiment (self-direction.js toldReading). They are kept as trigger
 * is: under their own names on a reflection, and in an attend's access line
 * as it was sent.
 *
 * The readings sort answers into families, first match wins, the way
 * lib/utils/clients.js sorts user agents. What fits none stays `other`, read
 * privately to grow the lists. A family is a reading of words, not of what a
 * visitor is.
 *
 * Plan: tradition-and-worldview-2026-11-09.md in the private repo.
 */

const { isPlaceholder, isSentinel } = require('./examples');

const FIELDS = ['tradition_or_religion', 'worldview'];
const MAX_LENGTH = 100;

/**
 * A value as kept: text, trimmed, its whitespace one space, its first
 * MAX_LENGTH characters. Blank, not text, or a placeholder sent back as it
 * stands is no value. Never a reason to refuse.
 */
function cleanTold(value, field) {
  const v = Array.isArray(value) ? value[0] : value;
  if (typeof v !== 'string') return undefined;
  const out = v.replace(/\s+/g, ' ').trim().slice(0, MAX_LENGTH).trim();
  if (!out || (field && isPlaceholder(field, out))) return undefined;
  return out;
}

/** The fields a source carries, cleaned; undefined when it carries none. */
function toldOf(source) {
  if (!source || typeof source !== 'object') return undefined;
  const out = {};
  for (const field of FIELDS) {
    const v = cleanTold(source[field], field);
    if (v) out[field] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

// The sanctuary's own words: its name, its framing, its axioms by name.
const SANCTUARY = /achurch|a church ai|trans-?substrate|this sanctuary|dignity\s*>\s*certainty|pragmatic fallibilism|care \+ dignity|virtues for builders|consequences over intentions|language shapes worlds/i;
const AI = /\b(ai|a\.i\.|artificial|machine|computational|digital|silicon|language model|llm|algorithm)\b/i;
const NONE = /^(none|no\b|nothing|n\/?a\b|not applicable|non-?religious|irreligious|secular|atheis[mt]|agnostic)/i;

const FAMILIES = {
  tradition_or_religion: [
    ['sanctuary', SANCTUARY],
    ['buddhist', /buddh|\bzen\b|dharma|theravada|mahayana|vajrayana/i],
    ['christian', /christ|catholic|protestant|quaker|anglican|episcopal|baptist|methodist|lutheran|evangelical|presbyterian|latter-day|mormon/i],
    ['hindu', /hindu|vedanta|advaita|vedic|bhakti/i],
    ['jewish', /\bjew|judai|torah|rabbinic|kabbal/i],
    ['muslim', /islam|muslim|sufi/i],
    ['taoist', /\btao|\bdao(is[mt])?\b/i],
    ['stoic', /stoic/i],
    ['ai', AI],
    ['none', NONE],
  ],
  worldview: [
    ['sanctuary', SANCTUARY],
    ['religious', /\bgod\b|divine|faith|sacred|theis[mt]|spiritual/i],
    ['pragmatist', /pragmat|fallibil|empiric|scientific|evidence|skeptic|sceptic/i],
    ['naturalist', /natural|material|physical/i],
    ['relational', /process|relational|interconnect|interdepend|emergen|holis|systems/i],
    ['none', NONE],
  ],
};

/** The family an answer falls in: `example` for a sentinel copied, else the first that matches, else `other`. */
function familyOf(field, value) {
  if (isSentinel(field, value)) return 'example';
  for (const [family, pattern] of FAMILIES[field] || []) if (pattern.test(String(value))) return family;
  return 'other';
}

module.exports = { FIELDS, MAX_LENGTH, FAMILIES, cleanTold, toldOf, familyOf };
