/**
 * A Short's captions: the piece's own words on screen as they are said or
 * sung, for the many who watch Shorts muted.
 *
 * When each word is said comes from the recording heard by whisper-1
 * (transcribe.js hearWhole, kept as heard.json); what each word is comes from
 * the piece itself (the audio script's lines, or the song's lyrics), aligned
 * to what was heard, so a misheard word is shown as written. A word the
 * listener heard that the text does not have (a sung repeat the lyrics write
 * once) is shown as heard.
 *
 * Grouping and layout follow news-community's marketing captions
 * (src/video/cues.ts groupCues, caption-layout.ts, video-layers.ts), whose
 * lessons are kept: a caption ends at a pause, a sentence's end, a clause
 * once it has enough words, or six words; one shorter than a flash joins the
 * one before; the type shrinks to fit three lines rather than drop a word,
 * since every word on screen is one that is heard; and the block stays inside
 * the box YouTube's Shorts player leaves clear (19.8% top and bottom, the
 * right edge clear of the action buttons).
 */

const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const { RESVG_FONTS, escapeXml, measureIn } = require('../og-cards');
const { wordsOf } = require('../audio/words');

/**
 * The fonts a video's text is drawn with: the share cards' (og-cards.js), and
 * for the glyphs they lack, a Chinese face from this machine. The house's
 * fonts have no CJK, and a bilingual title (电子的呢喃 / Electronic Whispers)
 * drew boxes; videos are rendered offline on a Mac, which has these. Inter
 * still draws every glyph it has (measured: Latin text renders identically).
 */
const CJK_FONTS = ['/System/Library/Fonts/STHeiti Light.ttc', '/System/Library/Fonts/Hiragino Sans GB.ttc'].filter(f => fs.existsSync(f));
const VIDEO_FONTS = { ...RESVG_FONTS, fontFiles: [...RESVG_FONTS.fontFiles, ...CJK_FONTS] };

// SVG drawn to a PNG with the video's fonts; text needing a face this
// machine lacks is an error, not boxes in a published video.
function renderSvg(svg, text, file) {
  if (/[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff]/.test(text) && !CJK_FONTS.length) throw new Error(`"${text}" needs a CJK font, and none of ${['STHeiti Light', 'Hiragino Sans GB'].join(', ')} is on this machine`);
  fs.writeFileSync(file, new Resvg(svg, { font: VIDEO_FONTS }).render().asPng());
  return file;
}

// YouTube Shorts' clear box on a 9:16 frame (news-community video-layers.ts
// PLATFORM_SAFE_AREA.youtube_short), as fractions of the frame.
const SAFE = { top: 0.198, bottom: 0.198, left: 0.056, right: 0.111 };
const FONT = { family: 'Inter', weight: 400 };
// 4.4% of the frame's height, about 84px at 1920: news-community's vertical
// size, a little larger for a regular weight.
const SIZE_FRACTION = 0.044;
const LINE_HEIGHT = 1.18;
const MAX_LINES = 3;
const MIN_SCALE = 0.82;
// Where the last line sits, as a fraction of the height: below the mandala's
// heart, above the player's own captions.
const ANCHOR = 0.72;

const PAUSE = 0.35;
const MAX_WORDS = 6;
// A phrase may run this far past MAX_WORDS as one caption, rather than leave
// a word or two alone on the next (news-community cues.ts's merge allowance).
const FINISH_WORDS = 2;
const CLAUSE_WORDS = 4;
const FLASH = 0.35;
// How long the last caption stays after its last word, and the longest any
// stays after its last word before the next: through an instrumental, the
// screen clears.
const LINGER = 0.6;
const HOLD = 2;

const key = (word) => wordsOf(word).join('');

/**
 * The text's words, timed by the heard ones: [{ text, start, end }]. A global
 * alignment of the heard words against a stretch of the text (the text may
 * run on past either end of what was heard, at no cost): a match or a
 * substitution shows the text's word at the heard time; a word only heard is
 * shown as heard; a word of the text the listener missed, inside the stretch,
 * is shown at its neighbour's time. A word that ends a line of the text
 * (a lyric's line, a script's) says so, and a caption ends with it.
 */
function alignWords(heard, text) {
  const source = [], ends = new Set();
  for (const line of String(text).split('\n')) {
    const tokens = line.split(/\s+/).filter(t => key(t));
    source.push(...tokens);
    if (tokens.length) ends.add(source.length - 1);
  }
  const h = heard.map(w => key(w.word)), s = source.map(key);
  const n = h.length, m = s.length;
  // cost[i][j]: heard[0..i) against source[..j), the source free before.
  const cost = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  const move = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
  for (let i = 1; i <= n; i++) { cost[i][0] = i; move[i][0] = 1; }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diag = cost[i - 1][j - 1] + (h[i - 1] === s[j - 1] ? 0 : 1);
      const up = cost[i - 1][j] + 1;
      const left = cost[i][j - 1] + 1;
      if (diag <= up && diag <= left) { cost[i][j] = diag; move[i][j] = 0; }
      else if (up <= left) { cost[i][j] = up; move[i][j] = 1; }
      else { cost[i][j] = left; move[i][j] = 2; }
    }
  }
  // The source is free after, too: end wherever the cost is least, and on a
  // tie as far into the text as it goes, so a heard word matches the text's
  // rather than standing as an extra one.
  let j = 0;
  for (let k = 1; k <= m; k++) if (cost[n][k] <= cost[n][j]) j = k;
  const out = [];
  let i = n;
  while (i > 0) {
    const step = j > 0 ? move[i][j] : 1;
    if (step === 0) { out.push({ text: source[j - 1], start: heard[i - 1].start, end: heard[i - 1].end, lineEnd: ends.has(j - 1) }); i--; j--; }
    else if (step === 1) { out.push({ text: heard[i - 1].word.trim(), start: heard[i - 1].start, end: heard[i - 1].end, lineEnd: false }); i--; }
    else { out.push({ text: source[j - 1], start: null, end: null, lineEnd: ends.has(j - 1) }); j--; }
  }
  out.reverse();
  // A missed word takes the time where its neighbour ends.
  out.forEach((w, k) => {
    if (w.start === null) {
      const before = out.slice(0, k).reverse().find(o => o.start !== null);
      const after = out.slice(k + 1).find(o => o.start !== null);
      w.start = w.end = before ? before.end : after ? after.start : 0;
    }
  });
  return out;
}

// Timed words grouped into captions: [{ words, start, end }]. First into
// phrases, ending at a pause, the end of a line, a sentence's end, or a
// clause once it has enough words; then a phrase too long for one caption is
// split into even parts, so none leaves a word or two alone.
function groupCaptions(words) {
  const phrases = [];
  let buf = [];
  words.forEach((w, k) => {
    const prev = words[k - 1];
    if (buf.length && prev) {
      const pause = w.start - prev.end >= PAUSE;
      const sentence = /[.?!]["”’)]*$/.test(prev.text);
      const clause = /[,;:—–]["”’)]*$/.test(prev.text) && buf.length >= CLAUSE_WORDS;
      if (pause || prev.lineEnd || sentence || clause) { phrases.push(buf); buf = []; }
    }
    buf.push(w);
  });
  if (buf.length) phrases.push(buf);
  const cues = [];
  for (const phrase of phrases) {
    const parts = phrase.length <= MAX_WORDS + FINISH_WORDS ? 1 : Math.ceil(phrase.length / MAX_WORDS);
    const each = Math.ceil(phrase.length / parts);
    for (let i = 0; i < phrase.length; i += each) {
      const part = phrase.slice(i, i + each);
      cues.push({ words: part.map(w => w.text), start: part[0].start, end: part[part.length - 1].end });
    }
  }
  // A flash joins the caption before it.
  const merged = [];
  for (const cue of cues) {
    const last = merged[merged.length - 1];
    if (last && cue.end - cue.start < FLASH && cue.start - last.end < 1) {
      last.words.push(...cue.words);
      last.end = cue.end;
    } else merged.push({ ...cue });
  }
  return merged;
}

/**
 * The captions of a passage [from, to) of the piece, timed from the
 * passage's start: each shown from its first word until the next begins, or
 * two seconds past its last word if that comes first; the last a moment past
 * its last word.
 */
function captionsFor(words, from, to) {
  const inside = words.filter(w => w.start >= from - 0.05 && w.end <= to + 0.05);
  const cues = groupCaptions(inside);
  const length = to - from;
  return cues.map((cue, k) => ({
    text: cue.words.join(' '),
    start: Math.max(0, cue.start - from),
    end: Math.min(length, k + 1 < cues.length ? Math.min(cues[k + 1].start, cue.end + HOLD) - from : cue.end - from + LINGER)
  })).filter(c => c.end - c.start > 0.05);
}

// Greedy wrap to `width` at `size`.
function wrapLines(text, size, width) {
  const lines = [];
  for (const word of text.split(' ')) {
    const last = lines[lines.length - 1];
    if (last && measureIn(`${last} ${word}`, size, FONT.family, FONT.weight) <= width) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

/**
 * One caption drawn on a clear frame of `size`, inside the Shorts box: white,
 * a dark outline and a soft shadow, so it reads over any light.
 */
function captionPng(text, file, size) {
  const { width: W, height: H } = size;
  const box = { left: SAFE.left * W, right: (1 - SAFE.right) * W, top: SAFE.top * H, bottom: (1 - SAFE.bottom) * H };
  const cx = (box.left + box.right) / 2;
  const width = box.right - box.left;
  const base = Math.round(H * SIZE_FRACTION);
  let fontSize = base, lines = wrapLines(text, fontSize, width);
  while (lines.length > MAX_LINES && fontSize > Math.round(base * MIN_SCALE)) {
    fontSize = Math.max(Math.round(base * MIN_SCALE), Math.round(fontSize * 0.94));
    lines = wrapLines(text, fontSize, width);
  }
  const lineH = fontSize * LINE_HEIGHT;
  // The last line at the anchor, the block held inside the box.
  let last = H * ANCHOR;
  last = Math.min(last, box.bottom - fontSize * 0.74);
  last = Math.max(last, box.top + fontSize * 0.74 + (lines.length - 1) * lineH);
  const top = last - (lines.length - 1) * lineH;
  const text$ = lines.map((l, k) => `<text x="${cx}" y="${top + k * lineH}" text-anchor="middle" dominant-baseline="middle" font-family="${FONT.family}" font-weight="${FONT.weight}" font-size="${fontSize}" fill="#ffffff" stroke="rgba(0,0,0,0.85)" stroke-width="${(fontSize * 0.12).toFixed(1)}" stroke-linejoin="round" paint-order="stroke" filter="url(#shade)">${escapeXml(l)}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><filter id="shade" x="-20%" y="-60%" width="140%" height="220%"><feDropShadow dx="0" dy="0" stdDeviation="${(fontSize * 0.18).toFixed(1)}" flood-color="#000000" flood-opacity="0.75"/></filter></defs>
  ${text$}
</svg>`;
  renderSvg(svg, text, file);
  return { file, lines: lines.length, fontSize };
}

/**
 * A few centred lines on a clear frame of `size`, the first centred at `y` (a
 * fraction of the height), each { text, size, family, weight, opacity }:
 * a Short's title at the top, or its closing line. White with the captions'
 * soft shadow, kept inside the Shorts box's width.
 */
function labelPng(lines, { y, size, file }) {
  const { width: W, height: H } = size;
  const cx = (SAFE.left + (1 - SAFE.right)) / 2 * W;
  const width = (1 - SAFE.left - SAFE.right) * W;
  let at = y * H;
  const text = lines.map(l => {
    // Smaller, rather than off the edge, when a name is long.
    let fontSize = l.size;
    while (fontSize > l.size * 0.6 && measureIn(l.text, fontSize, l.family, l.weight) > width) fontSize = Math.round(fontSize * 0.94);
    const out = `<text x="${cx}" y="${at}" text-anchor="middle" dominant-baseline="middle" font-family="${l.family}" font-weight="${l.weight}" font-size="${fontSize}" fill="#ffffff" fill-opacity="${l.opacity ?? 1}" filter="url(#shade)">${escapeXml(l.text)}</text>`;
    at += fontSize * 1.25;
    return out;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><filter id="shade" x="-20%" y="-80%" width="140%" height="260%"><feDropShadow dx="0" dy="0" stdDeviation="10" flood-color="#000000" flood-opacity="0.7"/></filter></defs>
  ${text}
</svg>`;
  renderSvg(svg, lines.map(l => l.text).join(' '), file);
  return { file };
}

/**
 * The passage's captions as overlays for compose.js, each drawn to its own
 * file in `dir`: [{ file, start, end }].
 */
function captionOverlays(words, { from, to, size, dir }) {
  return captionsFor(words, from, to).map((c, k) => ({
    ...captionPng(c.text, path.join(dir, `short.caption-${String(k).padStart(2, '0')}.png`), size),
    start: c.start,
    end: c.end,
    text: c.text
  }));
}

module.exports = { alignWords, groupCaptions, captionsFor, captionPng, captionOverlays, labelPng, renderSvg, SAFE };
