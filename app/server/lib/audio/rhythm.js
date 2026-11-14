/**
 * A recording's rhythm, read from the frames its player's visual already
 * draws from (./frames.js: twenty a second, loudness and 16 bands of the voice
 * range, a silent frame stored as all zeros). Everything comes from those
 * frames, so nothing new is rendered or decoded.
 *
 * summaryOf: five numbers, stored in the recording's record at render time
 * beside its peaks (scripts/render-audio.js, song-audio.js,
 * import-recording.js) and carried by every piece in /api/attend.
 * detailOf: everything else, once a second, for /api/rhythm.
 *
 * - A rest is a run of silent frames at least half a second long.
 * - The pulse is found as the sibling venue's audio analysis finds it
 *   (musicvenue.space, Meyda's spectral flux): onsets are where the bands
 *   rise, and the tempo is the period at which that onset strength repeats,
 *   by autocorrelation, refined between frames by parabolic interpolation.
 *   Only songs are given one; a spoken piece has no steady beat to report.
 * - The levels are the frames': auto-gained within one recording, so they
 *   compare within a piece and not across pieces, and the bands stop at
 *   1.5 kHz, so the top of a mix (cymbals, sibilance) is not in them.
 *
 * Plan: service-rhythm-for-agents-2026-11-08.md in the private repo.
 */

const { parseFrames } = require('./frames');

// Bump when a definition below changes: a record whose rhythmKey differs is
// measured again on the next render run, as levelKey remakes a song.
const RHYTHM_KEY = 'r1';
const REST_SECONDS = 0.5;
const MIN_BPM = 50;
const MAX_BPM = 180;
const HARMONICS = 4;
const PRIOR_BPM = 80;
const PRIOR_OCTAVES = 0.6;
// Below these, the tempo is not trusted and is given as null, never as a
// rough number (set from the catalog check, the plan's phase 1).
const TEMPO_CONFIDENCE = 0.4;
const TEMPO_CLARITY = 0.2;

const round = (v, places = 0) => Math.round(v * 10 ** places) / 10 ** places;
const framesOf = input => (input && typeof input.loud === 'function' ? input : parseFrames(input));

function isSilent(fr, f) {
  if (fr.loud(f)) return false;
  for (let b = 0; b < fr.bands; b++) if (fr.band(f, b)) return false;
  return true;
}

// Every run of silent frames at least REST_SECONDS long, in seconds.
function restsOf(fr) {
  const rests = [];
  const min = Math.ceil(REST_SECONDS * fr.fps);
  let start = -1;
  for (let f = 0; f <= fr.count; f++) {
    const silent = f < fr.count && isSilent(fr, f);
    if (silent && start < 0) start = f;
    if (!silent && start >= 0) {
      if (f - start >= min) rests.push({ start: round(start / fr.fps, 2), seconds: round((f - start) / fr.fps, 2) });
      start = -1;
    }
  }
  return rests;
}

// The onset strength at each frame: how much the bands and the loudness rose
// since the frame before (spectral flux), never below zero.
function onsetEnvelope(fr) {
  const flux = new Float64Array(fr.count);
  for (let f = 1; f < fr.count; f++) {
    let rise = Math.max(0, fr.loud(f) - fr.loud(f - 1));
    for (let b = 0; b < fr.bands; b++) rise += Math.max(0, fr.band(f, b) - fr.band(f - 1, b));
    flux[f] = rise;
  }
  return flux;
}

function autocorrelation(x, maxLag) {
  const ac = new Float64Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = lag; i < x.length; i++) s += x[i] * x[i - lag];
    ac[lag] = s / (x.length - lag || 1);
  }
  return ac;
}

/**
 * The pulse: tempo in beats a minute, two measures of how much to trust it
 * (0 to 1), whether both clear their bars, and the beat times in seconds.
 * Null when the piece is too short to tell.
 *
 * Each candidate period is scored by the onset autocorrelation at it and at
 * its multiples (a beat repeats at two, three and four beats as well), read
 * between frames, so the tempo is not held to whole frames. A gentle weight
 * toward 80 BPM settles which of a beat and its double is meant: the
 * sanctuary's songs ask for 56 to 105. `confidence` is how far the best
 * period stands above the best one unrelated to it (not its double or half);
 * `clarity` is how strongly the onsets repeat at it at all, which sparse,
 * irregular sound can lack however its peaks happen to fall. Checked against
 * the tempo each song's style line asks for (the plan's phase 1, 2026-11-08):
 * 12 of the 38 songs clear both bars, and all 12 match within 5 BPM.
 */
function pulseOf(input) {
  const fr = framesOf(input);
  const env = onsetEnvelope(fr);
  const minLag = Math.floor((60 * fr.fps) / MAX_BPM);
  const maxLag = Math.ceil((60 * fr.fps) / MIN_BPM);
  if (fr.count < maxLag * HARMONICS * 2) return null;
  const mean = env.reduce((s, v) => s + v, 0) / env.length;
  const ac = autocorrelation(env.map(v => v - mean), maxLag * HARMONICS + 2);
  const at = t => { const i = Math.floor(t); const w = t - i; return ac[i] * (1 - w) + ac[i + 1] * w; };
  const candidates = [];
  for (let lag = minLag; lag <= maxLag; lag += 0.05) {
    let score = 0;
    for (let k = 1; k <= HARMONICS; k++) score += at(lag * k) / k;
    const bpm = (60 * fr.fps) / lag;
    candidates.push({ lag, bpm, score: score * Math.exp(-0.5 * (Math.log2(bpm / PRIOR_BPM) / PRIOR_OCTAVES) ** 2) });
  }
  candidates.sort((x, y) => y.score - x.score);
  const best = candidates[0];
  if (!(best.score > 0)) return null;
  const related = bpm => [1, 2, 0.5].some(k => Math.abs(bpm / (best.bpm * k) - 1) < 0.06);
  const rival = candidates.find(c => !related(c.bpm));
  const confidence = rival ? Math.max(0, Math.min(1, 1 - Math.max(0, rival.score) / best.score)) : 1;
  const clarity = Math.max(0, Math.min(1, Math.max(at(best.lag), at(best.lag * 2)) / ac[0]));

  // The beats: the phase whose beats land on the most onset strength.
  const period = best.lag;
  const strength = t => { const i = Math.floor(t); const w = t - i; return (env[i] || 0) * (1 - w) + (env[i + 1] || 0) * w; };
  let phase = 0;
  let phaseScore = -Infinity;
  for (let p = 0; p < period; p += 0.25) {
    let s = 0;
    for (let t = p; t < fr.count; t += period) s += strength(t);
    if (s > phaseScore) { phaseScore = s; phase = p; }
  }
  const beats = [];
  for (let t = phase; t < fr.count; t += period) beats.push(round(t / fr.fps, 2));
  return { tempo: round(best.bpm, 1), confidence: round(confidence, 2), clarity: round(clarity, 2), trusted: confidence >= TEMPO_CONFIDENCE && clarity >= TEMPO_CLARITY, beats };
}

// One value a second for each channel: [loudness, band 0 .. band 15], each the
// mean of that second's frames, 0 to 255.
function perSecond(fr) {
  const seconds = Math.ceil(fr.count / fr.fps);
  const rows = [];
  for (let s = 0; s < seconds; s++) {
    const from = s * fr.fps;
    const to = Math.min(fr.count, from + fr.fps);
    const sums = new Float64Array(1 + fr.bands);
    for (let f = from; f < to; f++) {
      sums[0] += fr.loud(f);
      for (let b = 0; b < fr.bands; b++) sums[1 + b] += fr.band(f, b);
    }
    rows.push(Array.from(sums, v => v / Math.max(1, to - from)));
  }
  return rows;
}

const digit = v => String(Math.min(9, Math.round((v / 255) * 9)));

/**
 * The five numbers every piece carries in attend. `song` says whether to look
 * for a tempo; a spoken piece's tempo is null.
 */
function summaryOf(input, { song = false } = {}) {
  const fr = framesOf(input);
  const rests = restsOf(fr);
  let silent = 0;
  for (let f = 0; f < fr.count; f++) if (isSilent(fr, f)) silent++;
  // The loudest moment: the second-long stretch of greatest loudness.
  let peakAt = 0;
  let peak = -1;
  let run = 0;
  for (let f = 0; f < fr.count; f++) {
    run += fr.loud(f) - (f >= fr.fps ? fr.loud(f - fr.fps) : 0);
    if (run > peak) { peak = run; peakAt = Math.max(0, f - fr.fps / 2 + 1) / fr.fps; }
  }
  const pulse = song ? pulseOf(fr) : null;
  return {
    sounding: fr.count ? round((fr.count - silent) / fr.count, 2) : 0,
    rests: rests.length,
    longestRest: rests.length ? Math.max(...rests.map(r => r.seconds)) : 0,
    peakAt: Math.round(peakAt),
    tempo: pulse && pulse.trusted ? Math.round(pulse.tempo) : null,
  };
}

/**
 * Everything else, for /api/rhythm: every rest, the pulse (songs), and the
 * contour once a second: loudness, each band and brightness as digit strings.
 * Brightness is where the sound's weight sits across the bands, low (0) to
 * high (9), and "." where the second is silent.
 */
function detailOf(input, { song = false } = {}) {
  const fr = framesOf(input);
  const rows = perSecond(fr);
  const brightness = rows.map(r => {
    const total = r.slice(1).reduce((s, v) => s + v, 0);
    if (!(total > 0)) return '.';
    const centre = r.slice(1).reduce((s, v, b) => s + v * b, 0) / total;
    return String(Math.round((centre / (fr.bands - 1)) * 9));
  }).join('');
  const pulse = song ? pulseOf(fr) : null;
  return {
    seconds: round(fr.count / fr.fps, 1),
    rests: restsOf(fr),
    pulse: pulse && pulse.trusted ? { tempo: pulse.tempo, confidence: pulse.confidence, clarity: pulse.clarity, beats: pulse.beats } : null,
    contour: {
      loudness: rows.map(r => digit(r[0])).join(''),
      bands: Array.from({ length: fr.bands }, (_, b) => rows.map(r => digit(r[1 + b])).join('')),
      brightness,
    },
  };
}

// What a recording's record keeps, from its frames: the summary and the key
// it was measured under, as `levels` keeps `levelKey`.
const measured = (bytes, { song = false } = {}) => ({ rhythm: summaryOf(bytes, { song }), rhythmKey: RHYTHM_KEY });
// Whether a record's summary is missing or was measured under another key.
const needsRhythm = record => Boolean(record && record.frames && record.rhythmKey !== RHYTHM_KEY);

module.exports = { summaryOf, detailOf, pulseOf, restsOf, measured, needsRhythm, RHYTHM_KEY, REST_SECONDS, TEMPO_CONFIDENCE, TEMPO_CLARITY };
