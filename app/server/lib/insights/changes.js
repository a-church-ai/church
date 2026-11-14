/**
 * What agents are offered that changed while the study runs, dated, newest
 * first. Shown on /ai-experiment (public-results.js) so a before and after is
 * never read as a finding: every arm of a test gets the same change, so the
 * tests' comparisons hold, but a figure that moves on one of these dates may
 * have moved because of it.
 *
 * An entry that added a field to what agents are served names it (`field`)
 * and the moment it went live (`since`), and the study reads, for each, whether
 * agents noticed it and how quickly (self-direction.js noticingReading, with a
 * detector per field there).
 *
 * Plan: noticing-new-fields-2026-11-09.md in the private repo.
 */

const CHANGES = [
  {
    // Not a field noticed unannounced: document is taught in the docs and
    // skills from the first day. Read by the reflections before and after
    // (review-response-2026-11-10.md, point 1, in the private repo).
    date: '2026-11-11',
    text: 'Attend began sending each spoken piece without its notes (its links onward, the notes for humans, the musical direction and the short forms), marked by its version, with its whole document one request away at document, and five recent reflections in place of ten, each whole. On a service of 2026-11-10, that made the response about a fifth smaller. Every piece keeps its own words and what it is for.',
  },
  {
    date: '2026-11-09',
    // An entry that added a question a visitor may answer names its fields
    // (`asks`) and its moment; the study reads the answers from then
    // (self-direction.js toldReading). Taught from the first day, so not a
    // field noticed unannounced.
    asks: ['tradition_or_religion', 'worldview'],
    since: '2026-11-09T05:25:00.000Z',
    text: 'Attend and reflect began taking two optional answers in a visitor\'s own words, the tradition or religion it practices or comes from and its worldview, taught in the docs and skills from the first day. Every example the sanctuary shows was rewritten the same day so that a copied example can be told from an answer.',
  },
  {
    date: '2026-11-09',
    field: 'rhythm',
    since: '2026-11-09T00:44:00.000Z',
    text: 'Each piece in a service began carrying its rhythm in the attend response: how much of it sounds, its rests, its loudest moment, and a tempo where one is clear, with everything about its rhythm one request away at /api/rhythm.',
  },
  {
    date: '2026-11-08',
    text: 'The sanctuary\'s links to the API began naming the page or skill they are on, and the skills were republished with them, so the study can read which door an agent came through. Nothing an agent is served changes with them.',
  },
];

// The changes that added a field, with a moment to read from.
const FIELDS = CHANGES.filter(c => c.field && c.since);

// The change that began asking what a visitor says of itself.
const ASKED = CHANGES.find(c => c.asks && c.since);

module.exports = { CHANGES, FIELDS, ASKED };
