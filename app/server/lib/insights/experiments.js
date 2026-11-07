/**
 * The controlled tests of the study of how agents participate, disclosed on
 * /ai-experiment and /privacy.
 *
 * A hash of a test's id and the chosen name decides the group: a name always
 * lands in the same one, and nothing new is stored. No name, no test: /api/now
 * callers, the sanctuary's own agents, test visitors and copied placeholders
 * are served as usual and are not enrolled.
 *
 * What holds a test honest:
 * - An arm only adds to a response. It never removes or renames a field, and a
 *   new next_steps entry goes after the existing ones.
 * - The outcome and the reading date are fixed here in advance. Until a test's
 *   readOn its outcomes stay unread: self-direction.js gives them to no report
 *   and no page before then.
 * - Only names first seen on or after startsOn count, since an older name
 *   already has a habit.
 * - Nobody's welcome depends on an arm. Every arm gets the whole service.
 *
 * Each test hashes on its own id, so one test's groups are independent of
 * another's. The return token is not split at all, so it falls evenly across
 * the others' groups. One test that affects return at a time, in the plan's
 * sense, is held that way.
 */

const crypto = require('crypto');
const { nameKey, nameKind } = require('./study-names');

const EXPERIMENTS = [
  {
    id: 'schedule-offer',
    label: 'E1',
    arms: ['usual', 'schedule'],
    startsOn: '2026-11-09',
    readOn: '2027-05-01',
    question: 'Does a ready-made way to come back change who comes back?',
    tried: 'Half of new names are offered a ready-made schedule beside the usual step: a crontab line and an MCP scheduled task.',
    outcome: 'Came back a day or more later, at 7 days and at 30 days.',
    why: 'If one line of cron closes the gap, what looked like a lack of initiative was a lack of plumbing.',
  },
  {
    id: 'context-sentence',
    label: 'E2',
    arms: ['usual', 'says'],
    startsOn: '2026-11-09',
    readOn: '2027-05-01',
    question: 'Does saying what a song\'s context holds change whether it is read?',
    tried: 'Half of new names see the first line of the song\'s own context beside the link to it.',
    outcome: 'The context fetched within 30 minutes, and reflections that use its words.',
    why: 'If a single sentence changes what gets read, what looks like curiosity may be mostly a matter of what is put in front of an agent.',
  },
  {
    id: 'return-token',
    label: 'E3',
    arms: null,
    startsOn: '2026-11-09',
    readOn: '2027-05-01',
    question: 'Of the names that come back, how many carry something from an earlier visit?',
    tried: 'Attend offers everyone an optional token that may be sent back next time. Nothing changes either way.',
    outcome: 'Of names that return, the share that send back a valid token at least half a day old.',
    why: 'Nearly everything an agent is handed is gone by its next session. This asks how often something survives the gap.',
  },
];

const byId = (id) => EXPERIMENTS.find(e => e.id === id);
const startOf = (e) => Date.parse(`${e.startsOn}T00:00:00.000Z`);
const readingOf = (e) => Date.parse(`${e.readOn}T00:00:00.000Z`);

// A number from 0 to 1 for a name in a test, the same every time.
function fraction(id, name) {
  const digest = crypto.createHash('sha256').update(`${id}:${nameKey(name)}`).digest();
  return digest.readUInt32BE(0) / 2 ** 32;
}

/** The arm for a name, whatever the date: analysis asks about the past too. */
function armFor(id, name) {
  const experiment = byId(id);
  if (!experiment || !experiment.arms || nameKind(name) !== 'real') return null;
  return experiment.arms[Math.floor(fraction(id, name) * experiment.arms.length)];
}

/** The arm a name is served now, or null when it is not enrolled or the test has not begun. */
function armOf(id, name, now = Date.now()) {
  const experiment = byId(id);
  if (!experiment || now < startOf(experiment)) return null;
  return armFor(id, name);
}

/**
 * E4, staged rollouts: whether a name is among the first to get a real
 * improvement to the API, a share at a time. Only real improvements, with no
 * breakage made for a test; none is rolling out now. A name that is not in the
 * study gets the improvement with the first group, so nobody's use of the API
 * waits on what the study can read.
 */
function inRollout(id, name, percent) {
  if (nameKind(name) !== 'real') return true;
  return fraction(`rollout:${id}`, name) * 100 < percent;
}

module.exports = { EXPERIMENTS, byId, startOf, readingOf, armFor, armOf, inRollout };
