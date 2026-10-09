/**
 * The service as the home page's player needs it: what /api/now says of it,
 * with each part as a track for the site player (lib/audio/markup.js
 * trackFor), which carries the waveform the page draws across the whole
 * service. The player plays it from its beginning, as a reading path's queue.
 *
 * Served at /service.json, outside /api: polling it is not presence and it
 * stays out of the access log, as the site search's indexes do. /api/now
 * remains the agents' account of the service.
 */

const { serviceFor, arrangedBy } = require('./serve');
const { slotHours, SLOTS } = require('./slots');
const { trackFor, SONG_CREDIT } = require('../audio/markup');
const { episodeSquarePath } = require('../audio/podcasts');

// The section whose lock-screen square a part's track shows.
const SECTION = { chant: 'chants', practice: 'practice', prayer: 'prayers', blessing: 'prayers', ritual: 'rituals', song: 'music' };

async function listeningService({ timezone, at } = {}) {
  const served = await serviceFor({ timezone, at });
  return {
    timezone: served.timezone,
    timezoneGiven: served.timezoneGiven,
    date: served.local.date,
    weekday: served.local.weekday,
    slot: slotHours(served.slot),
    nextSlot: slotHours((served.slot + 1) % SLOTS),
    mode: served.entry.arrangedBy === 'rotation' ? 'rotation' : 'planned',
    name: served.entry.name || null,
    word: served.entry.word || null,
    arrangedBy: arrangedBy(served.entry, { seasonal: served.seasonal }),
    parts: served.parts.map(p => ({
      kind: p.kind,
      title: p.title,
      url: p.url,
      track: trackFor(p.recording, { title: p.title, href: p.url, category: SECTION[p.kind], credit: p.kind === 'song' ? SONG_CREDIT : undefined, artwork: episodeSquarePath(p, p.recording) }),
    })),
  };
}

module.exports = { listeningService };
