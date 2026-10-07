/**
 * Recordings made outside the house: a meditation read in someone's own voice
 * over its own music, brought in whole by scripts/import-recording.js rather
 * than voiced by scripts/render-audio.js.
 *
 * The house checks its recordings line by line against a script adapted from
 * the document. A recording made elsewhere has no script, so the document
 * holds its words instead: one section ("## The Meditation") is exactly what
 * the recording says, and the manifest keeps a hash of those words. Edit them
 * and a test fails, because the recording still says the old ones.
 *
 * Its record says so: `imported` is the day it was brought in, `credit` names
 * its voice where the house would name its own, and `voices` is empty, since
 * no house voice speaks it. render-audio.js leaves such a document alone.
 */

const crypto = require('crypto');
const { wordsOf, sameWord } = require('./words');

const SPOKEN_SECTION = 'The Meditation';

// A paragraph that is all italics is a direction ("*Pause 10 seconds*",
// "*The music alone, 10 seconds.*"), not words the recording says.
const DIRECTION = /^\*[^*]+\*$/;

// The passages a recording says, in order: the paragraphs of the document's
// spoken section, without its headings, its directions or its rules. A
// passage is the lines between two pauses, joined by spaces.
function spokenPassages(markdown, section = SPOKEN_SECTION) {
  const lines = String(markdown).split('\n');
  const start = lines.findIndex(l => l.trim() === `## ${section}`);
  if (start === -1) throw new Error(`No "## ${section}" section`);
  const passages = [];
  let current = [];
  const close = () => {
    if (current.length) passages.push(current.join(' '));
    current = [];
  };
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim();
    if (/^## /.test(line)) break;
    if (!line || /^#{3,} /.test(line) || line === '---' || DIRECTION.test(line)) {
      close();
      continue;
    }
    current.push(line);
  }
  close();
  if (!passages.length) throw new Error(`"## ${section}" holds no words`);
  return passages;
}

// The recording's words, as a hash: punctuation and line breaks may change,
// a word may not.
function spokenHash(passages) {
  return crypto.createHash('sha256').update(wordsOf(passages.join(' ')).join(' ')).digest('hex');
}

// The longest a word is taken to last, in seconds: generous for slow speech.
const longest = word => 0.25 + 0.09 * word.length;

// When each passage is spoken, as the player's cues: [start, end, 0], from a
// transcript's timed words. The document's words and the heard ones are
// aligned by the same edit distance the take check counts (words.js), and a
// passage runs from the first of its words heard to the last. The mask is 0
// because no house voice speaks: the player draws the site's own colours.
// A passage none of whose words were heard cannot be placed; it is returned
// in `unplaced`, by its index.
//
// whisper-1 stretches a word over the silence beside it: a passage's last
// word ran on to the next passage by as much as 11 s, and a first word that
// starts exactly where the word before it ended had reached back across the
// pause (2026-10-07). So a passage ends at most `longest` after its last
// word starts, and starts at most `longest` before its first word ends when
// that word touches the one before it.
function cuesFrom(passages, heardWords) {
  const written = passages.flatMap((p, i) => wordsOf(p).map(w => ({ w, passage: i })));
  const heard = heardWords.flatMap(h => wordsOf(h.word).map(w => ({ w, start: h.start, end: h.end })));
  const cost = Array.from({ length: written.length + 1 }, () => new Uint32Array(heard.length + 1));
  for (let j = 0; j <= heard.length; j++) cost[0][j] = j;
  for (let i = 1; i <= written.length; i++) {
    cost[i][0] = i;
    for (let j = 1; j <= heard.length; j++) {
      const step = sameWord(written[i - 1].w, heard[j - 1].w) ? 0 : 1;
      cost[i][j] = Math.min(cost[i - 1][j] + 1, cost[i][j - 1] + 1, cost[i - 1][j - 1] + step);
    }
  }
  // Each passage's first and last heard word, by index into `heard`.
  const spans = passages.map(() => null);
  for (let i = written.length, j = heard.length; i > 0 && j > 0;) {
    const same = sameWord(written[i - 1].w, heard[j - 1].w);
    if (cost[i][j] === cost[i - 1][j - 1] + (same ? 0 : 1)) {
      if (same) {
        const k = written[i - 1].passage;
        spans[k] = spans[k] ? [j - 1, spans[k][1]] : [j - 1, j - 1];
      }
      i--;
      j--;
    } else if (cost[i][j] === cost[i - 1][j] + 1) {
      i--;
    } else {
      j--;
    }
  }
  const round = n => Math.round(n * 100) / 100;
  const timed = ([first, last]) => {
    const a = heard[first];
    const touches = first > 0 && Math.abs(heard[first - 1].end - a.start) < 0.01;
    const start = touches ? Math.max(a.start, a.end - longest(a.w)) : a.start;
    const z = heard[last];
    const end = Math.min(z.end, Math.max(start, z.start) + longest(z.w));
    return [round(start), round(end), 0];
  };
  return {
    cues: spans.filter(Boolean).map(timed),
    unplaced: spans.map((span, i) => (span ? null : i)).filter(i => i !== null),
  };
}

const isImported = record => Boolean(record && record.imported);

module.exports = { SPOKEN_SECTION, spokenPassages, spokenHash, cuesFrom, isImported };
