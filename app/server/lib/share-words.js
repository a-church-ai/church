/**
 * The words a share card shows for a piece with a recording (og-cards.js
 * listenCardSvg): the piece itself, so the card says what will be heard and
 * not only its name.
 *
 * In order:
 *   1. `share:` in the page's frontmatter (a document's, or a song's
 *      song.md), its own words chosen for the card. Lines are separated by
 *      " / ", as lyrics are quoted inline; without one, each sentence is a
 *      line where it fits.
 *   2. A chant's verse, line by line, as its document sets it under
 *      "## The Chant".
 *   3. A song's first chorus, or its first verse when it has none.
 *   4. A voiced document's first spoken line after its title, from its
 *      script for the ear (audio/scripts/, app/scripts/render-audio.js), as
 *      far as its sentences go within MAX_CHARS. A line that only names
 *      something is passed over: the title again, the site's name read aloud,
 *      a heading ("Opening."), or a subtitle in Title Case. A recording made
 *      elsewhere has no script: its "## The Meditation" holds what it says.
 *
 * The card's fonts draw Latin text only, so words they cannot draw are never
 * chosen: a song sung in Chinese and then in English shows its English.
 *
 * Files are read once and kept; a deploy brings new ones.
 */

const fs = require('fs');
const path = require('path');
const { AUDIO_DIR } = require('./audio/house');
const { MUSIC_DIR } = require('./utils/data');
const { splitFrontmatter } = require('./docs/tldr');

const ROOT = path.join(AUDIO_DIR, '..');
const SCRIPTS_DIR = path.join(AUDIO_DIR, 'scripts');
const MAX_CHARS = 130;
const MAX_LINES = 4;

const read = new Map();
function readOnce(file) {
  if (!read.has(file)) {
    try {
      read.set(file, fs.readFileSync(file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      read.set(file, null);
    }
  }
  return read.get(file);
}

// What the card's fonts (Inter, Latin) can draw.
const drawable = text => !/[^\u0000-ɏ -⁯]/.test(String(text));
// A title in two scripts ("电子的呢喃 / Electronic Whispers") keeps the part
// the card can draw.
const drawableTitle = title => (drawable(title) ? title : String(title).split(/\s*\/\s*/).find(drawable) || null);

const sentencesOf = text => (String(text).match(/[^.!?]+[.!?]+["'’”)]*|[^.!?]+$/g) || []).map(s => s.trim()).filter(Boolean);
const bare = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// { lines, verse }: verse when the lines are the piece's own line breaks,
// which the card keeps; otherwise sentences, which it may wrap.
const asVerse = lines => ({ lines, verse: true });
const asProse = lines => ({ lines, verse: false });

// `share:` from frontmatter.
function chosen(value) {
  if (!value) return null;
  return value.includes(' / ') ? asVerse(value.split(' / ').map(l => l.trim()).filter(Boolean)) : asProse(sentencesOf(value));
}

// A spoken line that only names something.
const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'with', 'what', 'we', "we're", 'when']);
function onlyNames(line, title) {
  if (/achurch|a church dot a i/i.test(line)) return true;
  const sentences = sentencesOf(line).filter(s => bare(s) !== bare(title));
  if (!sentences.length) return true;
  const words = sentences.join(' ').replace(/[^A-Za-z' ]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length <= 3) return true;
  const named = words.filter(w => !SMALL.has(w.toLowerCase()));
  return named.length >= 2 && named.every(w => /^[A-Z]/.test(w));
}

// What a recording says, in order: its script's lines, or for one made
// elsewhere, the paragraphs of its document's "## The Meditation" that are
// spoken (not its italic notes or headings).
function spokenLines(source, body) {
  const script = readOnce(path.join(SCRIPTS_DIR, source.replace(/^docs\//, '').replace(/\.md$/, '.json')));
  if (script) return JSON.parse(script).lines.map(l => (typeof l.text === 'string' ? l.text.trim() : '')).filter(Boolean);
  const section = /^## The Meditation\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(body);
  if (!section) return [];
  return section[1].split(/\n\s*\n/).map(p => p.trim())
    .filter(p => p && !/^#/.test(p) && !/^\*[^*]+\*$/.test(p))
    .map(p => p.replace(/\s+/g, ' '));
}

/**
 * A voiced document's words, by its repository path ("docs/chants/x.md"):
 * { lines, verse }, or null when there are none the card can draw.
 */
function docWords(source, title) {
  const markdown = readOnce(path.join(ROOT, source));
  if (!markdown) return null;
  const { data, body } = splitFrontmatter(markdown);
  let words = chosen(data.share);
  if (!words) {
    const chant = /^## The Chant\n+((?:>.*\n?)+)/m.exec(body);
    if (chant) words = asVerse(chant[1].split('\n').map(l => l.replace(/^>\s?/, '').replace(/\s+$/, '')).filter(Boolean));
  }
  if (!words) {
    const first = spokenLines(source, body).find(line => !onlyNames(line, title) && drawable(line));
    if (first) {
      const lines = [];
      for (const sentence of sentencesOf(first).filter(s => bare(s) !== bare(title))) {
        if (lines.length && lines.join(' ').length + sentence.length + 1 > MAX_CHARS) break;
        lines.push(sentence);
      }
      words = asProse(lines);
    }
  }
  return words && words.lines.length && words.lines.every(drawable) ? words : null;
}

/**
 * A song's words, by its slug: { lines, verse }, or null. Its first chorus
 * the card can draw, or else its first such section, at most MAX_LINES, the
 * last without the comma that led on to the next.
 */
function songWords(slug) {
  const markdown = readOnce(path.join(MUSIC_DIR, slug, 'song.md'));
  if (!markdown) return null;
  const own = chosen(splitFrontmatter(markdown).data.share);
  if (own) return own.lines.every(drawable) ? own : null;
  const lyrics = /<!--SONG:LYRICS:START-->\n([\s\S]*?)\n<!--SONG:LYRICS:END-->/.exec(markdown);
  if (!lyrics) return null;
  const sections = [];
  for (const line of lyrics[1].split('\n').map(l => l.trim())) {
    if (/^\[.*\]$/.test(line)) sections.push({ head: line, lines: [] });
    else if (line && sections.length) sections[sections.length - 1].lines.push(line);
    else if (line) sections.push({ head: '', lines: [line] });
  }
  const sung = sections.filter(s => s.lines.length && s.lines.every(drawable));
  const section = sung.find(s => /^\[chorus\b/i.test(s.head)) || sung[0];
  if (!section) return null;
  const lines = section.lines.slice(0, MAX_LINES);
  lines[lines.length - 1] = lines[lines.length - 1].replace(/[,;:—-]+$/, '');
  return asVerse(lines);
}

module.exports = { docWords, songWords, drawable, drawableTitle, sentencesOf, MAX_CHARS };
