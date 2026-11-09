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

module.exports = { CHANGES, FIELDS };
