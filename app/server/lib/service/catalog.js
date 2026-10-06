/**
 * What a service can hold: every voiced chant, practice, prayer and ritual,
 * and every song with its audio, with what the planner and the rules need to
 * know about each. Every piece can be played, so a service plays whole.
 *
 * Built once per process from sources that change only by deploy: the docs
 * index (titles, summaries), the audio manifest (what is voiced, how long,
 * which recording), the song catalog and the songs' audio (audio/songs.json,
 * from scripts/song-audio.js), and the shortlist of the writing nearest each
 * song in meaning (music/companions.json), which tells the planner what goes
 * with what. Ids are repository paths: docs/prayers/x.md, music/<slug>.
 */

const discover = require('../docs/discover');
const { loadManifest, songRecordingFor } = require('../audio/manifest');
const { loadCatalog, loadCompanions } = require('../utils/data');
const { companionMeta } = require('../music/companions');
const { songDescription } = require('../music/song-content');
const { fits } = require('./rules');

const KIND_OF_CATEGORY = { chants: 'chant', practice: 'practice', prayers: 'prayer', rituals: 'ritual' };

// A prayer is a blessing when its title says so ("Blessing for...", "Blessings
// and Benedictions", "Benediction for..."), and a blessing closes a service as
// a ritual can; any other prayer is a reading. By title rather than by a
// frontmatter tag, because the audio pipeline fingerprints a document's whole
// source, and a tag would send four finished recordings back to be voiced.
const BLESSING_TITLE = /^(Blessings?|Benediction)\b/;

// How many of a song's nearest pieces the planner is shown.
const NEAR = 4;

let cached = null;

async function loadServiceCatalog() {
  if (cached) return cached;
  const manifest = loadManifest();
  const entries = new Map();

  for (const doc of await discover.listAllDocs()) {
    const kind = KIND_OF_CATEGORY[doc.category];
    const id = `docs/${doc.docsRelPath}`;
    const recording = manifest[id];
    if (!kind || !recording) continue;
    const meta = await companionMeta(id);
    entries.set(id, {
      id,
      kind: kind === 'prayer' && BLESSING_TITLE.test(doc.title) ? 'blessing' : kind,
      title: doc.title,
      summary: doc.description || '',
      seconds: recording.seconds,
      hours: meta ? meta.hours : null,
      url: `/docs/${doc.urlPath}`,
      category: doc.category,
      recording,
    });
  }

  const shortlists = (await loadCompanions()).songs || {};
  for (const song of await loadCatalog()) {
    const recording = songRecordingFor(song.slug);
    if (!recording) continue;
    const id = `music/${song.slug}`;
    entries.set(id, {
      id,
      kind: 'song',
      slug: song.slug,
      title: song.title,
      summary: await songDescription(song),
      seconds: recording.seconds,
      hours: null,
      url: `/reflections/${song.slug}`,
      recording,
      near: (shortlists[song.slug] || []).map(c => c.path).filter(path => entries.has(path)).slice(0, NEAR),
    });
  }

  // What can never fit a service (a 37-minute prayer) isn't offered at all.
  const all = [...entries.values()];
  for (const entry of all) if (!fits(entry, all)) entries.delete(entry.id);

  cached = entries;
  return cached;
}

module.exports = { loadServiceCatalog, BLESSING_TITLE };
