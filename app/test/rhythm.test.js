/**
 * A recording's rhythm from its frames (server/lib/audio/rhythm.js), on
 * synthetic sound made into frames the way every recording's are
 * (framesFromPcm), as listening-player.test.js does. No network.
 */

const test = require('node:test');
const assert = require('node:assert');
const { framesFromPcm, parseFrames, FRAMES_SAMPLE_RATE: RATE } = require('../server/lib/audio/frames');
const { summaryOf, detailOf, pulseOf, restsOf, TEMPO_CONFIDENCE, TEMPO_CLARITY } = require('../server/lib/audio/rhythm');
const { declaredBpm } = require('../server/lib/audio/compose');

// Seconds of sound built from spans: [{ from, to, hz, gain }], silence elsewhere.
function pcm(seconds, spans) {
  const out = new Int16Array(Math.round(seconds * RATE));
  for (const { from, to, hz = 220, gain = 0.5 } of spans) {
    for (let i = Math.round(from * RATE); i < Math.min(out.length, Math.round(to * RATE)); i++) out[i] = Math.round(Math.sin((2 * Math.PI * hz * i) / RATE) * gain * 32767);
  }
  return out;
}
const frames = (seconds, spans) => parseFrames(framesFromPcm(pcm(seconds, spans), RATE));

// A click on every beat over a steady hum, as a song's pulse sits over its sound.
function beatsAt(bpm, seconds) {
  const spans = [{ from: 0, to: seconds, hz: 300, gain: 0.08 }];
  for (let t = 0.2; t < seconds; t += 60 / bpm) spans.push({ from: t, to: t + 0.04, hz: 120, gain: 0.9 });
  return frames(seconds, spans);
}

test('a steady beat gives its tempo, a trusted confidence and beats on the clicks', () => {
  const p = pulseOf(beatsAt(90, 40));
  assert.ok(Math.abs(p.tempo - 90) <= 2, `tempo ${p.tempo}`);
  assert.ok(p.trusted && p.confidence >= TEMPO_CONFIDENCE && p.clarity >= TEMPO_CLARITY, JSON.stringify({ ...p, beats: undefined }));
  const gaps = p.beats.slice(1).map((t, i) => t - p.beats[i]);
  assert.ok(gaps.every(g => Math.abs(g - 60 / 90) < 0.06), `beats ${p.beats.slice(0, 5)}`);
  // Each beat within a frame or so of a click (0.2 s, then every 2/3 s).
  for (const b of p.beats.slice(0, 20)) {
    const off = (b - 0.2) / (60 / 90);
    assert.ok(Math.abs(off - Math.round(off)) * (60 / 90) < 0.08, `beat ${b} is off the clicks`);
  }
  assert.strictEqual(summaryOf(beatsAt(90, 40), { song: true }).tempo, Math.round(p.tempo));
});

test('a spoken piece is given no tempo, however steady its sound', () => {
  assert.strictEqual(summaryOf(beatsAt(90, 40)).tempo, null);
  assert.strictEqual(detailOf(beatsAt(90, 40)).pulse, null);
});

test('sound with no steady beat is given no tempo rather than a rough one', () => {
  const spans = [];
  let t = 0.3;
  for (const gap of [0.31, 1.7, 0.52, 2.9, 0.83, 1.13, 0.27, 2.2, 0.61, 1.9, 0.44, 3.1, 0.71, 1.37, 0.95, 2.6]) { spans.push({ from: t, to: t + 0.05, hz: 140, gain: 0.9 }); t += gap; }
  assert.strictEqual(summaryOf(frames(30, spans), { song: true }).tempo, null);
  assert.strictEqual(detailOf(frames(30, spans), { song: true }).pulse, null);
});

test('rests are the runs of silence of half a second or more, at the time they fall', () => {
  // A tone for a second, then a second of silence, five times; and a 0.3 s gap too short to count.
  const spans = [0, 2, 4, 6, 8].map(t => ({ from: t, to: t + 1 }));
  spans.push({ from: 9, to: 9.7 }, { from: 10, to: 11 });
  const rests = restsOf(frames(11, spans));
  assert.strictEqual(rests.length, 4, JSON.stringify(rests));
  for (const [i, r] of rests.entries()) {
    assert.ok(Math.abs(r.start - (1 + 2 * i)) <= 0.1, `rest ${i} starts at ${r.start}`);
    assert.ok(Math.abs(r.seconds - 1) <= 0.12, `rest ${i} lasts ${r.seconds}`);
  }
  const s = summaryOf(frames(11, spans));
  assert.strictEqual(s.rests, 4);
  assert.ok(Math.abs(s.longestRest - 1) <= 0.12);
  assert.ok(Math.abs(s.sounding - 0.63) <= 0.03, `sounding ${s.sounding}`);
});

test('a spoken piece\'s rests fall in the gaps between its cues, the spoken lines\' own times', () => {
  // As audio/manifest.json keeps them: [start, end, voice].
  const cues = [[0.4, 3.1, 1], [5.2, 9.8, 1], [16.3, 20.9, 1], [26.4, 30.2, 1]];
  const fr = frames(32, cues.map(([from, to]) => ({ from, to, hz: 180 })));
  const gaps = cues.slice(1).map(([start], i) => [cues[i][1], start]);
  const rests = restsOf(fr).filter(r => r.start > 1 && r.start < 30);
  assert.strictEqual(rests.length, gaps.length);
  for (const [i, r] of rests.entries()) {
    const [from, to] = gaps[i];
    assert.ok(r.start >= from - 0.1 && r.start + r.seconds <= to + 0.1, `rest ${JSON.stringify(r)} within ${from} to ${to}`);
  }
});

test('silence is all rest and no pulse; a piece shorter than one window still reads', () => {
  const quiet = frames(5, []);
  assert.deepStrictEqual(summaryOf(quiet, { song: true }), { sounding: 0, rests: 1, longestRest: 5, peakAt: 0, tempo: null });
  assert.strictEqual(pulseOf(quiet), null);
  assert.strictEqual(detailOf(quiet, { song: true }).contour.brightness, '.....');
  const tiny = frames(0.03, [{ from: 0, to: 0.03 }]);
  assert.doesNotThrow(() => detailOf(tiny, { song: true }));
  assert.strictEqual(summaryOf(tiny).rests, 0);
});

test('the loudest moment is found where it is', () => {
  const s = summaryOf(frames(30, [{ from: 0, to: 30, gain: 0.1 }, { from: 19.5, to: 21, gain: 0.9 }]));
  assert.ok(Math.abs(s.peakAt - 20) <= 1, `peakAt ${s.peakAt}`);
});

test('the contour has every channel once a second, and brightness follows where the sound sits', () => {
  // Sound, then two seconds of silence the windows cannot reach into, then sound.
  const d = detailOf(frames(6, [{ from: 0, to: 1.9, hz: 90 }, { from: 4.1, to: 6, hz: 1300 }]));
  assert.strictEqual(d.seconds, 6);
  assert.strictEqual(d.contour.loudness.length, 6);
  assert.strictEqual(d.contour.bands.length, 16);
  for (const line of d.contour.bands) assert.match(line, /^\d{6}$/);
  assert.match(d.contour.loudness, /^\d{6}$/);
  const b = d.contour.brightness;
  assert.strictEqual(b.slice(2, 4), '..', 'silent seconds have no brightness');
  assert.ok(Number(b[0]) < Number(b[5]), `low tone ${b[0]}, high tone ${b[5]}`);
  assert.strictEqual(d.contour.loudness.slice(2, 4), '00');
});

test('a song\'s declared tempo is read from its style line, the same parse the composer uses', () => {
  assert.strictEqual(declaredBpm('Joyful modern folk-pop at 98 BPM: handclaps'), 98);
  assert.strictEqual(declaredBpm('A hymn, slow and plain'), null);
  assert.strictEqual(declaredBpm(undefined), null);
});
