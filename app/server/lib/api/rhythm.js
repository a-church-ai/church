/**
 * GET /api/rhythm: everything about one piece's rhythm, in one request.
 *
 * /api/attend gives every piece of a service its summary (lib/api/shared.js
 * rhythmField); this gives one piece the whole: every rest, the pulse with its
 * beats (songs), and every measure of its sound once a second, read from the
 * frames its player already draws from (lib/audio/rhythm.js). Nothing is
 * delivered in time and nothing waits for a next part: an agent asks once.
 *
 * The frames are fetched as the audio router fetches them (audio/serve.js
 * ensureLocal) and each piece's detail is held by its content-hashed frames
 * filename, so a held result can never be stale.
 *
 * Plan: service-rhythm-for-agents-2026-11-08.md in the private repo.
 */

const fs = require('fs').promises;
const inputs = require('./inputs');
const ns = require('../utils/next-steps');
const { refuse } = require('./errors');
const { loadCatalog } = require('../utils/data');
const { songRecordingFor, recordingFor } = require('../audio/manifest');
const { ensureLocal } = require('../audio/serve');
const { detailOf, summaryOf } = require('../audio/rhythm');
const { BANDS, LOW_HZ, HIGH_HZ, FPS } = require('../audio/frames');
const { resolveServedDoc, docsRest } = require('../docs/serve');
const { cache } = require('../utils/cache');
const { KIND_OF_SECTION } = require('../docs/kinds');

const BANDS_HZ = Array.from({ length: BANDS }, (_, b) => [b, b + 1].map(i => Math.round(LOW_HZ + ((HIGH_HZ - LOW_HZ) * i) / BANDS)));

const FORMAT = `"ACF1" in bytes 0 to 3; byte 4 is frames a second (${FPS}); byte 5 is bands (${BANDS}); then one record a frame: its loudness, then each band from low to high, one byte each, 0 to 255. A silent frame is all zeros.`;

const ABOUT = [
  'Loudness and the bands are measured within this recording and scaled to it, so they compare within the piece, not across pieces.',
  `The bands cover the voice range, ${LOW_HZ} Hz to ${HIGH_HZ / 1000} kHz, so the top of a mix (cymbals, sibilance) is not in them.`,
  'A rest is a run of silence of half a second or more.',
  'The tempo is an estimate from the sound, given only where a steady beat is found clearly enough to trust.',
];

// Each piece's detail, read once from its frames, by its frames file and
// whether it is a song; a few kilobytes held, never the frames themselves.
const details = cache({
  name: 'rhythm',
  ttl: 365 * 24 * 3600 * 1000,
  load: async key => {
    const [file, kind] = key.split('|');
    const bytes = await fs.readFile(await ensureLocal(file));
    const song = kind === 'song';
    return { detail: detailOf(bytes, { song }), summary: summaryOf(bytes, { song }) };
  },
});

// The piece a request names: a song by its slug, else a served document by
// the path forms read_doc accepts. Null when it names nothing with frames.
async function pieceFor(name) {
  const record = songRecordingFor(name);
  if (record && record.frames) {
    const song = (await loadCatalog()).find(s => s.slug === name);
    return { kind: 'song', title: song ? song.title : name, record, song: true };
  }
  const resolved = await resolveServedDoc(docsRest(name));
  if (!resolved || !resolved.doc) return null;
  const doc = resolved.doc;
  const spoken = recordingFor(`docs/${doc.docsRelPath}`);
  if (!spoken || !spoken.frames) return null;
  return { kind: KIND_OF_SECTION[doc.category], title: doc.title, record: spoken, song: false };
}

async function rhythm(input, ctx) {
  const baseUrl = ctx.baseUrl;
  try {
    const { data, refused } = inputs.parseInput(inputs.rhythm, input);
    if (refused) {
      return refuse(refused.code, {
        ...refused,
        example: '/api/rhythm?piece=come-let-us-gather',
        suggestion: ns.suggestion('Each part of a service names its piece in rhythm.url, in /api/now and /api/attend.'),
        next_steps: [ns.observe(baseUrl), ns.attend(baseUrl)],
      });
    }
    const found = await pieceFor(data.piece);
    if (!found) {
      return refuse('not_found', {
        error: `No recorded piece is named ${data.piece.slice(0, 100)}`,
        suggestion: ns.suggestion('Use a song\'s slug, or a spoken piece\'s path under /docs, as each part\'s rhythm.url in /api/attend names it.'),
        next_steps: [ns.attend(baseUrl), ns.browseCatalog(baseUrl)],
      });
    }
    const { kind, title, record, song } = found;
    const { detail, summary } = await details.get(`${record.frames}|${song ? 'song' : 'spoken'}`);
    return { status: 200, body: {
      piece: data.piece,
      kind,
      title,
      recording: `${baseUrl}/audio/${record.file}`,
      seconds: detail.seconds,
      // The record's own, as attend gives it; measured now only for a record
      // made before its summary was stored.
      summary: record.rhythm || summary,
      rests: detail.rests,
      pulse: detail.pulse,
      contour: { ...detail.contour, bandsHz: BANDS_HZ },
      frames: { url: `${baseUrl}/audio/${record.frames}`, format: FORMAT },
      about: ABOUT,
      next_steps: [ns.attend(baseUrl)],
    } };
  } catch (err) {
    console.error('Rhythm error:', err);
    return refuse('internal', {
      error: 'The rhythm could not be read',
      suggestion: ns.suggestion('Try again in a moment.'),
      next_steps: [ns.attend(baseUrl)],
    });
  }
}

module.exports = { rhythm };
