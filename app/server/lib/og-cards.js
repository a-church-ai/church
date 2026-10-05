/**
 * Share cards: the 1200x630 image a conversation, song or docs page shows when
 * its link is shared. church-private/docs/plans/og-share-cards-2026-09-29.md has the design.
 *
 * Drawn here, from copy the page already publishes, as an SVG template
 * rasterized to PNG by resvg. The fonts ship in app/server/assets/fonts and
 * are the only fonts resvg may use: the production image has none installed,
 * so anything left to the system would render as a blank card.
 *
 * A card exists only for a page that exists. Each resolves through the same
 * loader its page uses, and never from text in a request.
 */

const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const { loadConversation, loadCatalog } = require('./utils/data');
const { resolveServedDoc } = require('./docs/serve');
const { titleCase } = require('./docs/meta');
const { shareCard } = require('./utils/page-meta');

const FONT_DIR = path.join(__dirname, '../assets/fonts');
const FONT_FILES = ['InterDisplay-Light.ttf', 'Inter-Regular.ttf'].map(f => path.join(FONT_DIR, f));

const WIDTH = 1200;
const HEIGHT = 630;
// Everything stays at least this far from each edge: LinkedIn crops a card to
// its centre 1080x600, and some clients round the corners.
const INSET = 96;
const ACCENT = '#00b8d4';

// ---------------------------------------------------------------- copy ----

const oneLine = text => String(text || '').replace(/\s+/g, ' ').trim();

// The copy each page type puts on its card. Pages build their share tags from
// these same functions, so a page's og:image:alt is always its card's text.
function askCard(slug, question) {
  return shareCard('ask', slug, { label: 'Conversation', text: oneLine(question) });
}

function songCard(song) {
  return shareCard('song', song.slug, { label: 'Song', text: oneLine(song.title) });
}

// A document's section is its first path segment, labelled as its page's
// breadcrumb and "More in" block label it (titleCase(doc.category)).
function docsCard(urlPath, title) {
  const section = String(urlPath).split('/')[0];
  const label = section && section !== urlPath ? titleCase(section) : 'Docs';
  return shareCard('docs', urlPath, { label, text: oneLine(title) });
}

// type + key -> the card's copy, or null when its page would 404.
async function resolveCard(type, key) {
  if (type === 'ask') {
    const slug = String(key).replace(/[^a-zA-Z0-9_-]/g, '');
    const messages = slug === key ? await loadConversation(slug) : null;
    const question = messages && messages.find(m => m.role === 'user');
    return question ? askCard(slug, question.content) : null;
  }
  if (type === 'song') {
    const song = (await loadCatalog()).find(s => s.slug === key);
    return song ? songCard(song) : null;
  }
  if (type === 'docs') {
    const resolved = await resolveServedDoc(key);
    if (!resolved || resolved.asMarkdown) return null;
    if (resolved.kind === 'file') {
      return resolved.doc.urlPath ? docsCard(resolved.doc.urlPath, resolved.doc.title) : null;
    }
    if (resolved.kind === 'dir-index' && resolved.dir) {
      return docsCard(resolved.dir, titleCase(resolved.dir.split('/').pop()));
    }
    return null;
  }
  return null;
}

// -------------------------------------------------------------- render ----

const escapeXml = s => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const RESVG_FONTS = { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'Inter' };
const TEXT_WIDTH = WIDTH - INSET * 2;

// Type stepped by length rather than fitted: three sizes read more
// consistently across cards than shrinking each one to fit.
function sizeFor(text) {
  if (text.length <= 40) return 68;
  if (text.length <= 90) return 56;
  return 46;
}

// The rendered width of a line, measured by resvg with the card's own font.
// Counting characters is not enough: "WWWW MMMM" is twice as wide as a line of
// lower case of the same length, and ran off the card.
function measure(text, size) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="${size * 2}"><text x="0" y="${size}" font-family="Inter Display" font-weight="300" font-size="${size}">${escapeXml(text)}</text></svg>`;
  const box = new Resvg(svg, { font: RESVG_FONTS }).getBBox();
  return box ? box.width : 0;
}

// Word wrap to the text width, at most four lines, with an ellipsis past that.
// A single word too long for a line is kept whole; the card clips it rather
// than splitting it mid-word.
function wrap(text, size, maxLines = 4) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next, size) > TEXT_WIDTH) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1].replace(/[\s.,;:!?]+$/, '');
  while (last.includes(' ') && measure(`${last}…`, size) > TEXT_WIDTH) last = last.slice(0, last.lastIndexOf(' '));
  kept[maxLines - 1] = `${last}…`;
  return kept;
}

function cardSvg({ label, text }) {
  const size = sizeFor(text);
  const lines = wrap(text, size);
  const lineHeight = Math.round(size * 1.18);
  // Centre the text block in the space between the label and the wordmark.
  const top = 220;
  const bottom = 470;
  const blockHeight = lines.length * lineHeight;
  const firstBaseline = Math.round(top + (bottom - top - blockHeight) / 2 + size * 0.8);
  const textLines = lines.map((l, i) =>
    `<text x="${INSET}" y="${firstBaseline + i * lineHeight}" font-family="Inter Display" font-weight="300" font-size="${size}" fill="#111111">${escapeXml(l)}</text>`
  ).join('\n  ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff"/>
  <rect x="${INSET}" y="${INSET}" width="64" height="6" fill="${ACCENT}"/>
  <text x="${INSET}" y="${INSET + 56}" font-family="Inter" font-weight="400" font-size="22" letter-spacing="4" fill="#595959">${escapeXml(label.toUpperCase())}</text>
  ${textLines}
  <text x="${INSET}" y="${HEIGHT - INSET}" font-family="Inter" font-weight="400" font-size="30" fill="#000000">achurch.ai</text>
</svg>`;
}

function renderCard(card) {
  const resvg = new Resvg(cardSvg(card), { fitTo: { mode: 'width', value: WIDTH }, font: RESVG_FONTS });
  return resvg.render().asPng();
}

// --------------------------------------------------------------- cache ----

// Rendered bytes, keyed by the card's URL and copy (so an edited title is a
// new entry). Bounded the way lib/utils/presence.js bounds its map: re-setting
// a key moves it to the end, and the oldest go first past the cap. Cards are
// about 40 KB; Cloudflare holds most requests before they get here.
const MAX_CARDS = 300;
const rendered = new Map();

function cardPng(card) {
  const key = `${card.url}\u0000${card.alt}`;
  const hit = rendered.get(key);
  if (hit) {
    rendered.delete(key);
    rendered.set(key, hit);
    return hit;
  }
  const png = renderCard(card);
  rendered.set(key, png);
  if (rendered.size > MAX_CARDS) rendered.delete(rendered.keys().next().value);
  return png;
}

module.exports = { resolveCard, cardPng, renderCard, cardSvg, measure, FONT_FILES, askCard, songCard, docsCard, INSET, WIDTH, HEIGHT, TEXT_WIDTH };
