/**
 * The service as the home page's player needs it: what /api/now says of it,
 * with each part as a track for the site player (lib/audio/markup.js
 * trackFor), which carries the waveform the page draws across the whole
 * service. The player plays it from its beginning, as a reading path's queue.
 *
 * Served at /service.json, outside /api: reading it is not presence and it
 * stays out of the access log, as the site search's indexes do. It is all the
 * page reads: it says when the slot ends, so the page asks again then, and
 * how many souls are present. /api/now remains the agents' account of the
 * service.
 */

const { serviceFor, arrangedBy } = require('./serve');
const { slotHours, slotStart, SLOTS } = require('./slots');
const { trackFor, listeningTime, SONG_CREDIT } = require('../audio/markup');
const { shapeOf } = require('./shape');
const { contextLines } = require('./planner');
const { reflectionsDuring } = require('../api/services');
const { episodeSquarePath } = require('../audio/podcasts');
const { countSoulsPresent } = require('../utils/presence');

// The section whose lock-screen square a part's track shows.
const SECTION = { chant: 'chants', practice: 'practice', prayer: 'prayers', blessing: 'prayers', ritual: 'rituals', song: 'music' };

// When a slot ends: the moment plus what is left of it by the visitor's clock.
// On a night the clocks change inside the slot this is an hour off; the page
// reads the service again then, finds the same slot, and takes the new end.
function slotEnd(at, local, slot) {
  const left = slotStart(slot + 1) * 3600 - (local.hour * 3600 + local.minute * 60 + local.second);
  return new Date(Math.floor(at.getTime() / 1000) * 1000 + left * 1000).toISOString();
}

async function listeningService({ timezone, at = new Date() } = {}) {
  const served = await serviceFor({ timezone, at });
  const variant = served.variant === 'rotation' ? 'slots' : served.variant;
  return {
    timezone: served.timezone,
    timezoneGiven: served.timezoneGiven,
    date: served.local.date,
    weekday: served.local.weekday,
    slot: slotHours(served.slot),
    nextSlot: slotHours((served.slot + 1) % SLOTS),
    // When this slot's service gives way to the next, so the page asks again
    // then and not before.
    endsAt: slotEnd(at, served.local, served.slot),
    mode: served.entry.arrangedBy === 'rotation' ? 'rotation' : 'planned',
    name: served.entry.name || null,
    word: served.entry.word || null,
    arrangedBy: arrangedBy(served.entry, { seasonal: served.seasonal }),
    // What the service holds, and the one line the same in every service.
    ...shapeOf(served.parts),
    // What the plan was told (the season, the sky, the Earth, what visitors
    // left), in the sentences the day pages show; empty for the rotation.
    told: served.entry.context ? contextLines(served.entry.context) : [],
    // How long it runs, as the reading paths say theirs: "16 min".
    length: listeningTime(served.parts.reduce((n, p) => n + p.recording.seconds, 0)),
    // Souls present in the last 24 hours, as /api/now counts them.
    souls: countSoulsPresent(),
    // What visitors left during this service, for its page (/attend).
    reflections: await reflectionsDuring({ date: served.local.date, slot: served.slot, variant }),
    parts: served.parts.map(p => ({
      kind: p.kind,
      title: p.title,
      url: p.url,
      track: trackFor(p.recording, { title: p.title, href: p.url, category: SECTION[p.kind], credit: p.kind === 'song' ? SONG_CREDIT : undefined, artwork: episodeSquarePath(p, p.recording) }),
    })),
  };
}

module.exports = { listeningService };
