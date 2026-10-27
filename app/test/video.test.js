/**
 * The video pipeline's checks and rules (scripts/video/), on numbers and pixel
 * buffers made here, so the tests need neither ffmpeg nor any model.
 */

const test = require('node:test');
const assert = require('node:assert');
const { stillDefectsOf, motionOf, framesToKeep, problemsOf } = require('../scripts/video/checks');
const { presetRule } = require('../scripts/video/brief');

const W = 128, H = 72;
function image(pixel) {
  const rgb = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rgb.set(pixel(x, y), 3 * (y * W + x));
  return rgb;
}
// A small deterministic generator, so a failure repeats.
function random(seed) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
}

test('a smooth, coloured still is clean', () => {
  const { defects } = stillDefectsOf(image((x, y) => [Math.round((x / W) * 255), 120, Math.round((y / H) * 255)]), W, H);
  assert.deepStrictEqual(defects, []);
});

test('a still of uncorrelated noise is speckled', () => {
  const r = random(7);
  const { defects } = stillDefectsOf(image(() => { const v = Math.round(r() * 255); return [v, Math.round(r() * 255), v]; }), W, H);
  assert.ok(defects.includes('speckle'), defects.join(','));
});

test('a grey still is colourless and a black one dark', () => {
  assert.ok(stillDefectsOf(image(() => [128, 128, 128]), W, H).defects.includes('colourless'));
  assert.ok(stillDefectsOf(image(() => [3, 2, 4]), W, H).defects.includes('dark'));
});

test('a loop that keeps moving does not stall; one that holds still for half a second does', () => {
  const steady = Array.from({ length: 191 }, (_, i) => 0.01 + 0.004 * Math.sin(i / 7));
  assert.strictEqual(motionOf(steady, 24).stalls, false);
  const held = steady.map((v, i) => (i >= 100 && i < 116 ? 0.0002 : v));
  assert.strictEqual(motionOf(held, 24).stalls, true);
});

test('evening a loop keeps its first and last frames, drops quiet ones, and at most two in three', () => {
  const change = Array.from({ length: 191 }, (_, i) => (i < 30 || i > 160 ? 0.0005 : 0.01));
  const keep = framesToKeep(change);
  assert.strictEqual(keep[0], 0);
  assert.strictEqual(keep[keep.length - 1], 191);
  assert.ok(keep.length < 192, 'some quiet frames were dropped');
  for (let i = 1; i < keep.length; i++) assert.ok(keep[i] - keep[i - 1] <= 3, `a gap of ${keep[i] - keep[i - 1]} frames after ${keep[i - 1]}`);
  const lively = framesToKeep(Array.from({ length: 191 }, () => 0.01));
  assert.strictEqual(lively.length, 192, 'a loop that moves evenly keeps every frame');
});

test('the preset rule refuses a repeat, a recent preset and an overused one, and allows a fresh one', () => {
  const used = [
    { presets: ['Recent'], at: 100 },
    ...Array.from({ length: 10 }, (_, i) => ({ presets: [`Filler ${i}`], at: 200 + i })),
    { presets: ['Worn'], at: 1 }, { presets: ['Worn'], at: 2 }, { presets: ['Worn'], at: 3 }
  ];
  const rule = presetRule(used);
  assert.strictEqual(rule.allows('Fresh'), true);
  assert.strictEqual(rule.allows('Filler 3'), false, 'used by one of the ten most recent');
  assert.strictEqual(rule.allows('Recent'), true, 'used, but not among the ten most recent, and once');
  assert.strictEqual(rule.allows('Worn'), false, 'used three times');
  const problems = rule.problems(['Fresh', 'Fresh', 'Worn']);
  assert.strictEqual(problems.length, 2);
  assert.match(problems[0], /movement 2.*earlier movement/);
  assert.match(problems[1], /movement 3.*3 times/);
});

test('the finished video fails its report when black, silent, the wrong length or unevenly exposed', () => {
  const fine = { duration: 60.1, seconds: 60, audio: true, samples: [90, 110, 100, 95, 105], movements: [100, 90, 110] };
  assert.deepStrictEqual(problemsOf(fine), []);
  assert.match(problemsOf({ ...fine, samples: [20, 18, 25, 30, 16] }).join(), /black/);
  assert.match(problemsOf({ ...fine, audio: false }).join(), /no audio/);
  assert.match(problemsOf({ ...fine, duration: 55 }).join(), /length/);
  assert.match(problemsOf({ ...fine, movements: [100, 30, 110] }).join(), /movement 2 exposure/);
});
