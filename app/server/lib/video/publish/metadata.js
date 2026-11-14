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

// The title from the copy: headline and name, or the older form without one.
function titled(title, copy, { short = false } = {}) {
  const forms = copy.headline
    ? [`${copy.headline} | ${title}`, copy.headline]
    : short ? [`${title} | ${SITE_NAME}`, title] : [`${title}: ${copy.descriptor} | ${SITE_NAME}`, `${title} | ${SITE_NAME}`, title];
  return forms.find(t => t.length <= TITLE_MAX) || forms[forms.length - 1].slice(0, TITLE_MAX);
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
 * YouTube's title opens on the copy's headline, the line that makes a
 * stranger curious, then the piece's name (titled). Copy written before
 * headlines existed has none, and its title names what the piece is for
 * someone searching (the copy's descriptor) as well as its name. The
 * channel's name is left to the channel, which YouTube shows beside every
 * title. The description opens with the copy's
 * lead (the lines shown above "...more"), then the piece's own description
 * and page, the chapters, the sanctuary, and three hashtags (YouTube shows
 * the first three above the title).
 */
async function metadataFor(piece, { title, edges, copy }) {
  const { description, page } = await about(piece);
  const marks = chapters(edges);
  const body = [
    copy.lead,
    copy.occasion,
    description,
    `${piece.song ? 'Read the song, its words and its story at' : 'Read the words at'} ${page}`,
    marks.length ? marks.join('\n') : null,
    `From ${SITE_NAME}, a sanctuary for humans, AI and every kind of mind. ${SITE}`,
    copy.tags.slice(0, 3).map(t => `#${t}`).join(' ')
  ].filter(Boolean).join('\n\n');
  return {
    title: titled(title, copy),
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

// What a Short that opens on a maker's spoken intro says of it.
const INTRO_LINE = 'The opening is an AI likeness of one of the people who make this sanctuary, speaking words they wrote and approved.';

const isShort = (description) => String(description || '').includes(SHORTS_TAG);

/**
 * A Short's words, from its full video's (`meta`, as metadataFor wrote them)
 * and the full video's address: its title (the same headline and name), the lead, where the whole piece
 * is (for a Short that is the whole piece, where it is in widescreen), the
 * piece's page, the sanctuary, and #Shorts with two of the copy's tags. No
 * chapters; no new copy.
 */
function shortMetadata(meta, { kind, url, whole = false, intro = false }) {
  const { title, lead, tags, occasion } = meta.copy;
  const body = [
    lead,
    occasion,
    // Said plainly as well as declared to YouTube: a likeness, never passed off.
    intro ? INTRO_LINE : null,
    `${whole ? `Watch the ${kind} in widescreen at` : `Watch the full ${kind} at`} ${url}`,
    `${kind === 'song' ? 'Read the song, its words and its story at' : 'Read the words at'} ${meta.page}`,
    `From ${SITE_NAME}, a sanctuary for humans, AI and every kind of mind. ${SITE}`,
    [SHORTS_TAG, ...tags.slice(0, 2).map(t => `#${t}`)].join(' ')
  ].filter(Boolean).join('\n\n');
  return {
    title: titled(title, meta.copy, { short: true }),
    description: body.slice(0, 5000),
    page: meta.page,
    tags: meta.tags,
    copy: meta.copy
  };
}

/**
 * The words a Bluesky or X post uses, from the video's (`meta`): the same,
 * but inside its occasion's window (utils/occasions.js) the occasion's tag leads and
 * its dated tag (#Election2026) follows it, for the people searching that
 * week. The YouTube video and Short never carry the dated tag; it would be
 * stale there in a year. `day` is the post's date on the schedule's clock.
 */
function socialMetadata(meta, occasion, day) {
  if (!occasion || !occasion.dated || day < occasion.from || day > occasion.to) return meta;
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  const rest = meta.copy.tags.filter(t => !same(t, occasion.tag) && !same(t, occasion.dated));
  return { ...meta, copy: { ...meta.copy, tags: [occasion.tag, occasion.dated, ...rest] } };
}

module.exports = { metadataFor, shortMetadata, socialMetadata, INTRO_LINE, isShort, chapters, timecode, titled, SITE, SHORTS_TAG };
