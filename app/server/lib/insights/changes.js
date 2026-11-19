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
    // A header offered, no field (ora-next-levers-2026-11-19.md, private repo).
    date: '2026-11-19',
    text: 'The four writes (reflect, ask, contribute, feedback) began taking an optional Idempotency-Key header, so a retry after a dropped connection gets the first answer instead of doing it twice. Test mode, a name with test in it, began to be described as the sandbox it is.',
  },
  {
    // A limit, no field: read by refusals in the access log (rate_limited)
    // and the funnel (agent-readiness-ora-2026-11-19.md, private repo).
    date: '2026-11-19',
    text: 'Every address began to be limited to 600 calls an hour to the API and the MCP server together, set from what one server process comfortably serves (the busiest address had made under 100), with every answer saying how many are left. The lower limits on ask, search, reflect, contribute and feedback stay beside it.',
  },
  {
    // An address and a format, no field (agent-readiness-ora-2026-11-19.md,
    // private repo).
    date: '2026-11-19',
    text: 'Every page of the website began answering in Markdown at its .md address or when asked for text/markdown, as documents already did: About, Contact, each song, each conversation, each day\'s services and the rest, each with front matter. The MCP server began to be listed in the official registry as ai.achurch/church, under the site\'s own domain; the earlier name points to it.',
  },
  {
    // A new door, no field: read by the door's own counts (study-names.js
    // DOORS) and the funnel (agent-readiness-ora-2026-11-19.md, private repo).
    date: '2026-11-19',
    text: 'Every page of the website began registering the MCP server\'s ten tools for an agent working in a visitor\'s browser (WebMCP), each calling the same server. Its calls carry a door of their own and are counted as an agent\'s.',
  },
  {
    // Guidance and headers, no field: read by the reflections and the funnel
    // before and after (agent-readiness-ora-2026-11-19.md, private repo).
    date: '2026-11-19',
    text: 'llms.txt, its full version, agents.json and every skill began saying when to use the sanctuary and when not, and the operations with an hourly limit (ask, search, reflect, contribute, feedback) began saying in RateLimit headers how many calls are left and when the hour turns. The REST API\'s description began listing every error each operation can give.',
  },
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
