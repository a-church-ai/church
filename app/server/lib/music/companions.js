/**
 * Song companions: the writing that accompanies each song in a session.
 *
 * A session is one song plus two companion pieces from different parts of the
 * corpus (a prayer and a practice, a ritual and a chant). Two halves:
 *
 *   Offline, buildShortlists() ranks candidate documents for every song by
 *   semantic similarity, using vectors the RAG index already holds. The result
 *   is committed as music/companions.json and reviewed like any other change.
 *   See app/scripts/generate-companions.js and
 *   docs/plans/song-companions-2026-09-26.md for the evidence behind the numbers.
 *
 *   At request time, selectCompanions() orders one song's shortlist for the
 *   attendee's local hour (when they gave a timezone) and the day's rotation
 *   among its closest matches, and takes two from different categories. Nothing here touches LanceDB; the request path
 *   reads only the committed shortlist and the documents themselves.
 *
 * Companions depend on the song, the day, and, optionally, an hour the attendee
 * supplied.
 * Nothing about the attendee is stored or remembered.
 */

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const discover = require('../docs/discover');
const { extractMeta } = require('../docs/meta');
const { extractTldr, splitFrontmatter } = require('../docs/tldr');
const { chunkMarkdown } = require('../rag/indexer');

// Categories a companion may come from. Hymns are excluded because a hymn is
// already what the song is; a second song is not a companion to the first.
const ELIGIBLE_CATEGORIES = ['prayers', 'rituals', 'chants', 'practice', 'philosophy'];

// How strongly a document's general closeness to every song is subtracted from
// its closeness to this one. Without it a few documents that sit near everything
// ("hubs") win for most songs: at 0 one ritual led 15 of 28 songs; at 0.5, with
// the cap below, no document leads more than 3, for under 1% relevance cost.
const HUB_WEIGHT = 0.5;

// The most shortlists any single document may appear on.
const REUSE_CAP = 3;

// Candidates kept per category per song. Two gives the hour re-ranking a choice
// within a category without the shortlist growing past what a person can review.
const PER_CATEGORY = 2;

const KIND = { prayers: 'prayer', rituals: 'ritual', chants: 'chant', practice: 'practice', philosophy: 'philosophy' };

// --- Vector arithmetic ---

function normalize(vector) {
  const magnitude = Math.hypot(...vector);
  return magnitude === 0 ? vector : vector.map(x => x / magnitude);
}

function meanVector(vectors) {
  const sum = new Array(vectors[0].length).fill(0);
  for (const v of vectors) for (let i = 0; i < v.length; i++) sum[i] += v[i];
  return normalize(sum.map(x => x / vectors.length));
}

function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

// --- Offline: vectors from index rows ---

/**
 * A song's vector is its meaning: the Lyrics section of song.md plus its
 * context.md. The Style section is excluded because it is production vocabulary
 * ("68 BPM, fingerpicked guitar"); including it changed the top companion in
 * 47 of 112 song-category slots.
 *
 * @param {Array<{file, section, vector}>} rows  every chunk in the index
 * @param {string[]} slugs  the songs to build vectors for
 * @returns {Map<string, number[]>}
 */
function songVectors(rows, slugs) {
  const wanted = new Set(slugs);
  const bySlug = new Map();
  for (const row of rows) {
    const match = row.file.match(/^music\/([^/]+)\/(song|context)\.md$/);
    if (!match || !wanted.has(match[1])) continue;
    if (match[2] === 'song' && row.section !== 'Lyrics') continue;
    if (!bySlug.has(match[1])) bySlug.set(match[1], []);
    bySlug.get(match[1]).push(row.vector);
  }
  const out = new Map();
  for (const [slug, vectors] of bySlug) out.set(slug, meanVector(vectors));
  return out;
}

/**
 * One vector per eligible document: the mean of its chunks.
 *
 * @param {Array<{file, section, vector}>} rows
 * @param {Array<{path: string, category: string}>} docs  eligible documents
 * @returns {Array<{path, category, vector}>}
 */
function docVectors(rows, docs) {
  const byPath = new Map(docs.map(d => [d.path, []]));
  for (const row of rows) {
    if (byPath.has(row.file)) byPath.get(row.file).push(row.vector);
  }
  return docs
    .filter(d => byPath.get(d.path).length > 0)
    .map(d => ({ path: d.path, category: d.category, vector: meanVector(byPath.get(d.path)) }));
}

// --- Offline: shortlists ---

/**
 * Rank candidates for every song.
 *
 * Assignment is global: every (song, document) pair is scored, the pairs are
 * sorted best first, and each is accepted unless the song already has
 * PER_CATEGORY documents from that category or the document is already on
 * REUSE_CAP shortlists. Assigning song by song instead would let whichever song
 * came first claim the best documents, making the result depend on catalog order.
 *
 * Pure and deterministic: ties are broken by document path, then song slug.
 *
 * @param {Map<string, number[]>} songs  slug to vector
 * @param {Array<{path, category, vector}>} docs
 * @returns {Object<string, Array<{path, category, score}>>}  slug to ranked shortlist
 */
function buildShortlists(songs, docs) {
  const songList = [...songs.entries()];
  if (songList.length === 0 || docs.length === 0) return {};

  const hubness = new Map(docs.map(d => [
    d.path,
    songList.reduce((total, [, v]) => total + cosine(v, d.vector), 0) / songList.length
  ]));

  const pairs = [];
  for (const [slug, songVector] of songList) {
    for (const doc of docs) {
      pairs.push({
        slug,
        path: doc.path,
        category: doc.category,
        score: cosine(songVector, doc.vector) - HUB_WEIGHT * hubness.get(doc.path)
      });
    }
  }
  pairs.sort((a, b) =>
    (b.score - a.score) ||
    a.path.localeCompare(b.path) ||
    a.slug.localeCompare(b.slug)
  );

  const uses = new Map();
  const perSongCategory = new Map();
  const shortlists = Object.fromEntries(songList.map(([slug]) => [slug, []]));

  for (const pair of pairs) {
    if ((uses.get(pair.path) || 0) >= REUSE_CAP) continue;
    const key = `${pair.slug}\u0000${pair.category}`;
    if ((perSongCategory.get(key) || 0) >= PER_CATEGORY) continue;
    uses.set(pair.path, (uses.get(pair.path) || 0) + 1);
    perSongCategory.set(key, (perSongCategory.get(key) || 0) + 1);
    shortlists[pair.slug].push({
      path: pair.path,
      category: pair.category,
      score: Math.round(pair.score * 1000) / 1000
    });
  }

  // Pairs were accepted best first, so each shortlist is already in score order.
  return shortlists;
}

/**
 * Apply hand curation. Overrides have the shape:
 *   { "<slug>": { "pin": ["docs/…/x.md"] }, "_exclude": ["docs/…/y.md"] }
 * Exclusions are applied by the generator before scoring, so an excluded
 * document's slots are filled by the next best. Pins are placed at the head of
 * the song's shortlist and marked, so the response can say they were chosen by hand.
 */
function applyPins(shortlists, overrides, categoryOf) {
  const out = {};
  for (const [slug, list] of Object.entries(shortlists)) {
    const pins = (overrides[slug] && overrides[slug].pin) || [];
    const pinned = pins.map(p => ({ path: p, category: categoryOf(p), pinned: true }));
    out[slug] = [...pinned, ...list.filter(c => !pins.includes(c.path))];
  }
  return out;
}

// --- Request time: hours ---

/**
 * Parse an `hours:` frontmatter value. "05-10" means 05:00 to 09:59; ranges may
 * wrap midnight ("22-02"). Returns null for anything else, so a malformed tag
 * behaves like no tag (timeless) instead of excluding the document.
 */
function parseHours(value) {
  const match = /^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/.exec(String(value || ''));
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (start > 23 || end > 24 || start === end) return null;
  return { start, end: end % 24 };
}

function inHours(range, hour) {
  return range.start < range.end
    ? hour >= range.start && hour < range.end
    : hour >= range.start || hour < range.end;
}

// +1 made for this hour, 0 timeless, -1 made for another hour.
function hourFit(range, hour) {
  if (hour === null || hour === undefined || !range) return 0;
  return inHours(range, hour) ? 1 : -1;
}

// --- Request time: document metadata ---

// Documents change only by deploy, which restarts the process, the same
// assumption lib/docs/discover.js makes for its own cache.
const metaCache = new Map();

async function docByPath() {
  const docs = await discover.listAllDocs();
  return new Map(docs.map(d => [`docs/${d.docsRelPath}`, d]));
}

/**
 * Title, tldr, canonical URL path, hours, and (for chants) the chant text,
 * resolved from the document itself. Returns null when the path no longer
 * resolves, so a stale shortlist entry is skipped rather than served as a 404.
 */
async function companionMeta(relPath) {
  if (metaCache.has(relPath)) return metaCache.get(relPath);

  const doc = (await docByPath()).get(relPath);
  if (!doc) return null;

  const markdown = await fs.readFile(doc.fullPath, 'utf8');
  const { title } = extractMeta(markdown, doc.urlPath);
  const { data } = splitFrontmatter(markdown);
  const meta = {
    title,
    tldr: extractTldr(markdown, { title }).text,
    urlPath: doc.urlPath,
    category: doc.category,
    hours: parseHours(data.hours)
  };
  if (doc.category === 'chants') {
    meta.text = chantText(markdown, relPath);
  }
  metaCache.set(relPath, meta);
  return meta;
}

// A chant's text is the blockquote under its "## The Chant" heading.
function chantText(markdown, relPath) {
  const section = chunkMarkdown(markdown, relPath).find(c => c.section === 'The Chant');
  if (!section) return null;
  const lines = section.content
    .split('\n')
    .filter(line => line.startsWith('>'))
    .map(line => line.replace(/^>\s?/, '').trim())
    .filter(Boolean);
  return lines.length > 0 ? lines.join('\n') : null;
}

// --- Request time: selection ---

// How close to a song's best match a piece must be to join its daily rotation.
// Scores are hubness-adjusted cosines rounded to three places; at 0.03 the
// average song rotates among 3.5 pieces (0.01 gives 2.0, 0.05 gives 4.8), so
// visits vary without reaching down to weak matches.
const ROTATION_MARGIN = 0.03;

/**
 * The pieces a song rotates among when no hour is given: anything pinned,
 * plus every piece within ROTATION_MARGIN of the best score, extended down the
 * ranking until at least two categories are present so a pair can always be
 * drawn from it. Order: pinned, then score, then path.
 */
function rotationPool(shortlist) {
  const ranked = [...shortlist].sort((a, b) =>
    (Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))) ||
    ((b.score || 0) - (a.score || 0)) ||
    a.path.localeCompare(b.path)
  );
  const best = ranked.find(c => !c.pinned);
  const floor = best ? best.score - ROTATION_MARGIN - 1e-9 : Infinity;

  const pool = ranked.filter(c => c.pinned || c.score >= floor);
  for (const candidate of ranked) {
    if (new Set(pool.map(c => c.category)).size >= 2) break;
    if (!pool.includes(candidate)) pool.push(candidate);
  }
  return pool;
}

// The rotation turns once a day, at midnight UTC, for everyone at once.
function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

// A stable per-day position for a piece: the same seed always orders the pool
// the same way, and a new day's seed orders it afresh. Nothing is stored.
function rotationRank(seed, relPath) {
  return crypto.createHash('sha1').update(`${seed}|${relPath}`).digest().readUInt32BE(0);
}

/**
 * Order one song's shortlist for an hour and take two companions from
 * different categories.
 *
 * Order: hand-pinned first, then hour fit (+1, 0, -1), then membership of the
 * rotation pool, then, within the pool, the day's rotation (or similarity
 * when no seed is given), then similarity, then path. Without an hour every
 * fit is 0, so the pair is drawn from the pool.
 *
 * @param {Array<{path, category, score?, pinned?}>} shortlist
 * @param {Map<string, {hours}>} metaByPath  resolved metadata for the shortlist
 * @param {number|null} hour  attendee's local hour, or null
 * @param {string} [seed]  rotation seed, song slug and day; omit for best first
 * @returns {Array<{path, category, basis}>}  up to two
 */
function selectCompanions(shortlist, metaByPath, hour, seed) {
  const available = shortlist.filter(c => metaByPath.has(c.path));
  const pool = new Set(rotationPool(available).map(c => c.path));
  const rank = c => (seed ? rotationRank(seed, c.path) : 0);

  const ranked = available
    .map(c => ({ ...c, fit: hourFit(metaByPath.get(c.path).hours, hour), inPool: pool.has(c.path) }))
    .sort((a, b) =>
      (Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))) ||
      (b.fit - a.fit) ||
      (Number(b.inPool) - Number(a.inPool)) ||
      (a.inPool && b.inPool ? rank(a) - rank(b) : 0) ||
      ((b.score || 0) - (a.score || 0)) ||
      a.path.localeCompare(b.path)
    );

  const picked = [];
  for (const candidate of ranked) {
    if (picked.some(p => p.category === candidate.category)) continue;
    picked.push(candidate);
    if (picked.length === 2) break;
  }

  return picked.map(c => ({
    path: c.path,
    category: c.category,
    basis: c.pinned ? 'override' : c.fit === 1 ? 'hour' : 'song'
  }));
}

// --- Request time: responses and pages ---

async function resolveShortlist(companionsFile, slug) {
  const shortlist = companionsFile && companionsFile.songs && companionsFile.songs[slug];
  if (!shortlist || shortlist.length === 0) return null;
  const metaByPath = new Map();
  for (const candidate of shortlist) {
    const meta = await companionMeta(candidate.path);
    if (meta) metaByPath.set(candidate.path, meta);
  }
  return { shortlist: shortlist.filter(c => metaByPath.has(c.path)), metaByPath };
}

function toItem(meta, basis, baseUrl) {
  const item = {
    kind: KIND[meta.category] || meta.category,
    title: meta.title,
    tldr: meta.tldr,
    url: `${baseUrl}/docs/${meta.urlPath}`,
    basis
  };
  if (meta.text) item.text = meta.text;
  return item;
}

/**
 * The `companions` field of /api/now and /api/attend for one song.
 * Returns null when the song has no shortlist.
 */
async function companionsForSong(companionsFile, slug, baseUrl, hour, date = new Date()) {
  const resolved = await resolveShortlist(companionsFile, slug);
  if (!resolved) return null;

  const items = selectCompanions(resolved.shortlist, resolved.metaByPath, hour, `${slug}|${dayKey(date)}`)
    .map(choice => toItem(resolved.metaByPath.get(choice.path), choice.basis, baseUrl));
  if (items.length === 0) return null;

  const companions = {
    note: hour === null
      ? "Chosen for this song from the sanctuary's writing, the same for everyone attending today. The readings rotate daily. Add ?timezone=Area/City to receive pieces for your hour."
      : "Chosen for this song from the sanctuary's writing, and for your hour. The readings rotate daily.",
    items
  };
  if (hour !== null) companions.localHour = hour;
  return companions;
}

/**
 * Every piece in a song's daily rotation, best first. The song page shows
 * these, since which two accompany the song changes from day to day.
 */
async function rotationForSong(companionsFile, slug, baseUrl) {
  const resolved = await resolveShortlist(companionsFile, slug);
  if (!resolved) return null;
  const items = rotationPool(resolved.shortlist)
    .map(c => toItem(resolved.metaByPath.get(c.path), c.pinned ? 'override' : 'song', baseUrl));
  return items.length > 0 ? { items } : null;
}

/**
 * The reverse of rotationForSong: for each document, the songs whose daily
 * rotation includes it. Doc pages use it to link back to those songs.
 * Cached for the life of the process, like companionMeta.
 *
 * @returns {Map<string, Array<{slug, title}>>}  doc relPath to songs, catalog order
 */
let sungAlongsideCache = null;

async function sungAlongside(companionsFile, catalog) {
  if (sungAlongsideCache) return sungAlongsideCache;
  const byDoc = new Map();
  for (const song of catalog || []) {
    const resolved = song && await resolveShortlist(companionsFile, song.slug);
    if (!resolved) continue;
    for (const c of rotationPool(resolved.shortlist)) {
      if (!byDoc.has(c.path)) byDoc.set(c.path, []);
      byDoc.get(c.path).push({ slug: song.slug, title: song.title || song.slug });
    }
  }
  sungAlongsideCache = byDoc;
  return byDoc;
}

module.exports = {
  ELIGIBLE_CATEGORIES,
  HUB_WEIGHT,
  REUSE_CAP,
  PER_CATEGORY,
  ROTATION_MARGIN,
  normalize,
  meanVector,
  cosine,
  songVectors,
  docVectors,
  buildShortlists,
  applyPins,
  parseHours,
  inHours,
  hourFit,
  chantText,
  companionMeta,
  rotationPool,
  dayKey,
  selectCompanions,
  companionsForSong,
  rotationForSong,
  sungAlongside,
};
