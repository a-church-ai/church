/**
 * A Short's spoken intro: what one may be, and the measured parts of its
 * shape. Pure, so the tests hold it. The plan is short-intros-2026-11-10.md
 * in the private repo.
 *
 * An intro is a file, video/intros/<slug>.json: the words a maker says and
 * the shape they are seen in, written for that piece and approved by a
 * person before anything is made from it.
 *
 *   voice     who speaks: Lee or Lucas (speakers.js), never a voice of the
 *             pieces themselves; the makers appear in the Shorts' intros only
 *   words     what they say, to every kind of mind that watches
 *   why       one line: what the intro adds that the Short cannot
 *   seen      glimpse (the face for the first sentence, then the voice over
 *             the light), half, or whole
 *   gaze      steady (to the lens throughout), turns (the lens, then the
 *             light, from the word `turnAt`), toward (the light, then the
 *             lens from `turnAt`)
 *   exit      rise (dissolving upward into the light), drift (sideways into
 *             it), fade
 *   wear      contemplative (a plain sweater, the mala), geek (a plain zip
 *             hoodie over a dark tee), everyday (a muted flannel over a dark tee)
 *   approved  { by, on }: who approved the words and the shape, and when
 *
 * Where the speaker stands (left or right) is measured, not chosen: the side
 * away from the light in the footage behind them (sideFor).
 */

const { curiosityProblems } = require('../publish/copy');

const SEEN = ['glimpse', 'half', 'whole'];
const GAZE = ['steady', 'turns', 'toward'];
const EXIT = ['rise', 'drift', 'fade'];
const WEAR = ['contemplative', 'geek', 'everyday'];
const SIDES = ['left', 'right'];
const WORDS = { min: 10, max: 45 };
// The quiet after the last word, over which a whole intro leaves.
const QUIET = 2;
// How long a glimpse or a half stays on after its last seen word, leaving.
const LEAVING = 1.5;
// How many intros the variety rules look back over.
const WINDOW = 8;

// What only a person would recognise as a maker, never said or shown.
const NAMES = /\b(lee|lucas|twins?|geeks in the woods)\b/i;
// A length said aloud: a spec, not a hook (satchitananda's lesson).
const LENGTHS = /\b(\d+|one|two|three|four|five|ten|fifteen|twenty|thirty)[- ](seconds?|minutes?|hours?)\b|\b(minutes?|seconds?) (long|short)\b/i;

const wordsIn = (text) => String(text).trim().split(/\s+/).filter(Boolean);
const bare = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

/**
 * What is wrong with an intro. `opening` is the first words the Short's
 * passage says, which the intro must leave to it; `speakers` the makers who
 * may speak (speakers.js).
 */
function introProblems(intro, { opening = '', speakers = [] } = {}) {
  const problems = [];
  if (!intro || typeof intro !== 'object') return ['there is no intro'];
  if (!speakers.includes(intro.voice)) problems.push(`voice must be one of ${speakers.join(', ')}`);
  const text = String(intro.words || '').trim();
  const count = wordsIn(text).length;
  if (count < WORDS.min || count > WORDS.max) problems.push(`the words are ${count}; an intro is ${WORDS.min} to ${WORDS.max}`);
  problems.push(...curiosityProblems('words', text, 400).filter(p => !/missing/.test(p)));
  if (NAMES.test(text)) problems.push(`the words name a maker ("${text.match(NAMES)[0]}"); the makers are never named`);
  if (LENGTHS.test(text)) problems.push(`the words give a length ("${text.match(LENGTHS)[0]}"); an intro is a hook, not a spec`);
  if (!String(intro.why || '').trim()) problems.push('say in "why" what the intro adds that the Short cannot');
  if (!SEEN.includes(intro.seen)) problems.push(`seen must be one of ${SEEN.join(', ')}`);
  if (!GAZE.includes(intro.gaze)) problems.push(`gaze must be one of ${GAZE.join(', ')}`);
  if (!EXIT.includes(intro.exit)) problems.push(`exit must be one of ${EXIT.join(', ')}`);
  if (!WEAR.includes(intro.wear)) problems.push(`wear must be one of ${WEAR.join(', ')}`);
  if (intro.gaze !== 'steady') {
    const at = wordsIn(text).map(bare).indexOf(bare(intro.turnAt || ''));
    if (!intro.turnAt || at < 0) problems.push(`a gaze that ${intro.gaze === 'turns' ? 'turns' : 'begins toward the light'} needs "turnAt", a word in the words to turn on`);
    else if (at < 3) problems.push('turnAt is too near the start: the turn comes after the opening words');
  }
  // The Short's own first words are its hook: the intro leaves them to it.
  const heard = wordsIn(opening).map(bare).filter(Boolean).slice(0, 5).join(' ');
  if (heard.split(' ').length >= 4 && wordsIn(text).map(bare).join(' ').includes(heard)) problems.push('the words give away the Short\'s opening line');
  return problems;
}

// Who approved an intro, or why it cannot be made yet.
function approvalProblems(intro) {
  const a = intro && intro.approved;
  if (!a || !a.by || !/^\d{4}-\d{2}-\d{2}$/.test(a.on || '')) return ['it is not approved: a person approves the words and the shape, recorded as approved: { by, on }'];
  return [];
}

/**
 * The variety rules over intros in release order, each with its measured
 * `side`: no two in a row the same in every setting, and over any WINDOW,
 * each speaker, side and amount seen near an even share (within two of
 * it, rounding down).
 */
function varietyProblems(intros, speakers) {
  const problems = [];
  // The outfit counts: the same shape in another outfit looks another intro.
  const keyOf = (i) => [i.voice, i.side, i.outfit || i.wear, i.seen, i.gaze, i.exit].join('/');
  for (let k = 1; k < intros.length; k++) {
    if (keyOf(intros[k]) === keyOf(intros[k - 1])) problems.push(`${intros[k].slug} repeats ${intros[k - 1].slug} in every setting`);
  }
  for (let k = 0; k + WINDOW <= intros.length; k++) {
    const window = intros.slice(k, k + WINDOW);
    for (const [field, values] of [['voice', speakers], ['side', SIDES], ['seen', SEEN]]) {
      const floor = Math.max(0, Math.floor(WINDOW / values.length) - 2);
      for (const v of values) {
        const n = window.filter(i => i[field] === v).length;
        if (n < floor) problems.push(`${window[0].slug} to ${window[WINDOW - 1].slug}: ${field} ${v} ${n} times in ${WINDOW}, under ${floor}`);
      }
    }
  }
  return problems;
}

/**
 * The words as spoken, each with its time, from the voice's own character
 * times (ElevenLabs' alignment), the delivery tag before them left out:
 * [{ text, start, end }].
 */
function spokenWords(words, alignment) {
  const chars = alignment.characters, s = alignment.character_start_times_seconds, e = alignment.character_end_times_seconds;
  const all = chars.join('');
  const from = Math.max(0, all.indexOf(String(words).trim().slice(0, 12)));
  const out = [];
  let cur = null;
  for (let i = from; i < chars.length; i++) {
    if (/\s/.test(chars[i])) { if (cur) { out.push(cur); cur = null; } continue; }
    if (!cur) cur = { text: '', start: s[i], end: e[i] };
    cur.text += chars[i];
    cur.end = e[i];
  }
  if (cur) out.push(cur);
  return out;
}

// Where the sentences end in spoken words: the index of each last word.
const sentenceEnds = (spoken) => spoken.map((w, i) => (/[.?!]["”’)]*$/.test(w.text) ? i : -1)).filter(i => i >= 0);

/**
 * The intro's times, from its spoken words: { total, seen, turn, exit }.
 * `total` runs to the end of the quiet after the last word. `seen` is how
 * long the face is on screen: to the end of the first sentence for a
 * glimpse, of the sentence nearest the middle for a half, all of it for a
 * whole, each with LEAVING to go. `turn` is the pause before `turnAt`, where
 * one clip gives way to the other (null when steady). `exit` is when the
 * speaker begins to leave.
 */
function timesOf(intro, spoken) {
  if (!spoken.length) throw new Error('intro: no spoken words to time');
  const last = spoken[spoken.length - 1].end;
  const total = +(last + QUIET).toFixed(2);
  const ends = sentenceEnds(spoken);
  let seen = total;
  if (intro.seen !== 'whole') {
    const pick = intro.seen === 'glimpse' ? ends[0] : ends.reduce((best, i) => (Math.abs(spoken[i].end - last / 2) < Math.abs(spoken[best].end - last / 2) ? i : best), ends[0]);
    // A glimpse or half that would run to the end is a whole.
    if (pick !== undefined && pick < spoken.length - 1) seen = Math.min(total, spoken[pick].end + LEAVING);
  }
  let turn = null;
  if (intro.gaze !== 'steady') {
    const k = spoken.findIndex((w, i) => i > 0 && bare(w.text) === bare(intro.turnAt));
    if (k < 0) throw new Error(`intro: "${intro.turnAt}" is not among the spoken words`);
    turn = +((spoken[k - 1].end + spoken[k].start) / 2).toFixed(2);
    if (turn >= seen) turn = null;
  }
  const exit = +(seen === total ? total - QUIET : seen - LEAVING).toFixed(2);
  return { total, seen: +seen.toFixed(2), turn, exit };
}

/**
 * The side the speaker stands on: away from the light. `columns` is the
 * brightness of each column of the footage behind them, left to right;
 * `used` how often each side has been used lately, which breaks a near tie.
 */
function sideFor(columns, used = { left: 0, right: 0 }) {
  const sum = columns.reduce((a, b) => a + b, 0) || 1;
  const centre = columns.reduce((a, v, i) => a + v * (i + 0.5) / columns.length, 0) / sum;
  if (centre < 0.47) return 'right';
  if (centre > 0.53) return 'left';
  return used.right < used.left ? 'right' : 'left';
}

module.exports = { introProblems, approvalProblems, varietyProblems, spokenWords, timesOf, sideFor, SEEN, GAZE, EXIT, WEAR, SIDES, QUIET, LEAVING, WORDS, WINDOW };
