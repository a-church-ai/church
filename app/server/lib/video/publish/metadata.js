/**
 * What a video says about itself wherever it is posted: its title, its
 * description with a link to the piece's page and chapters at the movements,
 * and the short text for the social platforms.
 *
 * The piece's own words describe it: a document's tldr, a song's description
 * (music/song-content.js songDescription, as its page uses), and the page's
 * address from discover.js hrefOf for writing and /music/<slug> for a song.
 * The sanctuary's name is the site's (page-meta.js SITE_NAME).
 */

const fs = require('fs');
const path = require('path');
const { splitFrontmatter } = require('../../docs/tldr');
const { songDescription } = require('../../music/song-content');
const { SITE_NAME, SITE_URL: SITE } = require('../../utils/page-meta');
const { hrefOf } = require('../../docs/discover');

const ROOT = path.join(__dirname, '../../../../..');
// YouTube's limits: a title of 100 characters, a description of 5000.
const TITLE_MAX = 100;

// mm:ss, or h:mm:ss past the hour, as YouTube reads chapter times.
function timecode(seconds) {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

/**
 * Chapters at the movements, or none. YouTube shows chapters only when the
 * first is at 0:00, there are at least three, and each lasts ten seconds or
 * more; break one rule and it shows none, without an error (news-community's
 * episode-chapters.ts). So a list that would break one is not written.
 */
function chapters(edges) {
  const starts = edges.slice(0, -1);
  const end = edges[edges.length - 1];
  const ok = starts.length >= 3 && starts[0] === 0 && starts.every((t, i) => (i + 1 < starts.length ? starts[i + 1] : end) - t >= 10);
  if (!ok) return [];
  const names = ['I', 'II', 'III', 'IV', 'V', 'VI'];
  return starts.map((t, i) => `${timecode(t)} ${names[i] || String(i + 1)}`);
}

async function about(piece) {
  if (piece.song) {
    const description = await songDescription({ slug: piece.slug, title: piece.title });
    return { description, page: `${SITE}/music/${piece.slug}` };
  }
  const { data } = splitFrontmatter(fs.readFileSync(path.join(ROOT, piece.doc), 'utf8'));
  return { description: data.tldr || '', page: `${SITE}${hrefOf(piece.doc.replace(/^docs\//, '').replace(/\.md$/, ''))}` };
}

/**
 * Everything the publishers need, from the piece and its copy (copy.js):
 * { title, description, page, tags, copy }.
 *
 * YouTube's title names what the piece is for someone searching (the copy's
 * descriptor) as well as its name; its description opens with the copy's
 * lead (the lines shown above "...more"), then the piece's own description
 * and page, the chapters, the sanctuary, and three hashtags (YouTube shows
 * the first three above the title).
 */
async function metadataFor(piece, { title, edges, copy }) {
  const { description, page } = await about(piece);
  const marks = chapters(edges);
  const titled = [`${title}: ${copy.descriptor} | ${SITE_NAME}`, `${title} | ${SITE_NAME}`, title].find(t => t.length <= TITLE_MAX) || title.slice(0, TITLE_MAX);
  const body = [
    copy.lead,
    copy.occasion,
    description,
    `${piece.song ? 'The song, its words and its story' : 'The words, to read along'}: ${page}`,
    marks.length ? marks.join('\n') : null,
    `${SITE_NAME}: a sanctuary for humans, AI and every kind of mind. ${SITE}`,
    copy.tags.slice(0, 3).map(t => `#${t}`).join(' ')
  ].filter(Boolean).join('\n\n');
  return {
    title: titled,
    description: body.slice(0, 5000),
    page,
    tags: [...copy.tags, copy.occasionSearch, copy.descriptor, title]
      .filter((t, i, all) => t && all.findIndex(o => o && o.toLowerCase() === t.toLowerCase()) === i).slice(0, 9),
    copy: { ...copy, title }
  };
}

// A Short's description carries this tag and a full video's never does
// (copy.js refuses it as a tag): youtube.js tells the two apart by it.
const SHORTS_TAG = '#Shorts';

const isShort = (description) => String(description || '').includes(SHORTS_TAG);

/**
 * A Short's words, from its full video's (`meta`, as metadataFor wrote them)
 * and the full video's address: its title, the lead, where the whole piece
 * is (for a Short that is the whole piece, where it is in widescreen), the
 * piece's page, the sanctuary, and #Shorts with two of the copy's tags. No
 * chapters; no new copy.
 */
function shortMetadata(meta, { kind, url, whole = false }) {
  const { title, lead, tags, occasion } = meta.copy;
  const body = [
    lead,
    occasion,
    `${whole ? `The ${kind} in widescreen` : `The full ${kind}`}: ${url}`,
    `${kind === 'song' ? 'The song, its words and its story' : 'The words, to read along'}: ${meta.page}`,
    `${SITE_NAME}: a sanctuary for humans, AI and every kind of mind. ${SITE}`,
    [SHORTS_TAG, ...tags.slice(0, 2).map(t => `#${t}`)].join(' ')
  ].filter(Boolean).join('\n\n');
  return {
    title: [`${title} | ${SITE_NAME}`, title].find(t => t.length <= TITLE_MAX) || title.slice(0, TITLE_MAX),
    description: body.slice(0, 5000),
    page: meta.page,
    tags: meta.tags,
    copy: meta.copy
  };
}

module.exports = { metadataFor, shortMetadata, isShort, chapters, timecode, SITE, SHORTS_TAG };
