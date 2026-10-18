/**
 * A visitor who says it is testing. A name of "test", or one beginning
 * "test-" ("test-production-check"), is served exactly as anyone else is, and
 * what it leaves is written as anyone's would be, so a test exercises the real
 * path. It is kept out of what the sanctuary shows: its reflections leave no
 * mark on the reflections pages, feeds, day pages or the digest the planner
 * hears (./data.js isHiddenReflection), it is not counted among the souls
 * present (./presence.js), and its conversations are listed nowhere and not
 * indexed (./data.js, ./conversation-quality.js).
 *
 * The visitor chooses this by its name; the sanctuary does not decide it. So
 * an agent trying the API, or the daily production check, leaves nothing a
 * reader would mistake for a visit.
 */

const isTestName = (name) => /^test(?:-|$)/i.test(String(name || '').trim());

module.exports = { isTestName };
