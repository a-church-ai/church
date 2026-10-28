/**
 * The video pipeline's checks and rules (lib/video/), on numbers and pixel
 * buffers made here, so the tests need neither ffmpeg nor any model.
 */

const test = require('node:test');
const assert = require('node:assert');
const { stillDefectsOf, motionOf, framesToKeep, problemsOf } = require('../server/lib/video/checks');
const fs = require('fs');
const os = require('os');
const path = require('path');

// The library reads VIDEO_DIR when it loads, as data.js reads DATA_DIR.
process.env.VIDEO_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'video-library-'));
const library = require('../server/lib/video/library');
const { reuseRule, check, MOVEMENTS } = require('../server/lib/video/brief');
const { toBase64, unit } = require('../server/lib/utils/vectors');
const { checkPassage, MIN_SECONDS, MAX_SECONDS } = require('../server/lib/video/short');

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

test('the reuse rule refuses a repeat, a recent item and an overused one, and allows a fresh one', () => {
  const used = [
    { items: ['Recent'], at: 100 },
    ...Array.from({ length: 10 }, (_, i) => ({ items: [`Filler ${i}`], at: 200 + i })),
    { items: ['Worn'], at: 1 }, { items: ['Worn'], at: 2 }, { items: ['Worn'], at: 3 }
  ];
  const rule = reuseRule(used, 'preset');
  assert.strictEqual(rule.allows('Fresh'), true);
  assert.strictEqual(rule.allows('Filler 3'), false, 'used by one of the ten most recent');
  assert.strictEqual(rule.allows('Recent'), true, 'used, but not among the ten most recent, and once');
  assert.strictEqual(rule.allows('Worn'), false, 'used three times');
  const problems = rule.problems(['Fresh', 'Fresh', 'Worn']);
  assert.strictEqual(problems.length, 2);
  assert.match(problems[0], /movement 2.*earlier movement/);
  assert.match(problems[1], /movement 3.*3 times/);
});

test('loops keep a shorter recency window than presets, so a catch-up batch can reuse them', () => {
  const used = Array.from({ length: 5 }, (_, i) => ({ items: [`video ${i}`], at: i }));
  const presets = reuseRule(used, 'preset');
  const loops = reuseRule(used, 'loop');
  assert.strictEqual(presets.allows('video 0'), false, 'a preset from five videos ago is still recent');
  assert.strictEqual(loops.allows('video 0'), true, 'a loop from five videos ago may be reused');
  assert.strictEqual(loops.allows('video 4'), false, 'a loop from one of the three most recent may not');
});

test('the finished video fails its report when black, silent, the wrong length or unevenly exposed', () => {
  const fine = { duration: 60.1, seconds: 60, audio: true, samples: [90, 110, 100, 95, 105], movements: [100, 90, 110] };
  assert.deepStrictEqual(problemsOf(fine), []);
  assert.match(problemsOf({ ...fine, samples: [20, 18, 25, 30, 16] }).join(), /black/);
  assert.match(problemsOf({ ...fine, audio: false }).join(), /no audio/);
  assert.match(problemsOf({ ...fine, duration: 55 }).join(), /length/);
  assert.match(problemsOf({ ...fine, movements: [100, 30, 110] }).join(), /movement 2 exposure/);
});

// A loop in the scratch library: its brief, its record and its evened file.
function libraryVideo(slug, { movements, at = Date.now(), vector = null, missingEven = false } = {}) {
  const dir = path.join(process.env.VIDEO_DIR, slug);
  fs.mkdirSync(dir, { recursive: true });
  const brief = { mood: `${slug} mood`, palette: ['#000000', '#111111', '#222222', '#333333', '#444444'], movements };
  fs.writeFileSync(path.join(dir, 'brief.json'), JSON.stringify(brief));
  fs.utimesSync(path.join(dir, 'brief.json'), at / 1000, at / 1000);
  movements.forEach((m, i) => {
    if (m.loop) return;
    const record = { file: `${slug}/loop-${i + 1}.mp4`, even: `${slug}/loop-${i + 1}.even.mp4`, seamless: true, ssim: 0.95, motion: { mean: 0.008 }, motionText: m.motion };
    if (vector) record.vector = toBase64(unit(vector));
    fs.writeFileSync(path.join(dir, `loop-${i + 1}.mp4.json`), JSON.stringify(record));
    if (!missingEven) fs.writeFileSync(path.join(dir, `loop-${i + 1}.even.mp4`), '');
  });
}

test('the library scans each video\'s loops, drops one whose files are gone, and embeds each loop once', async () => {
  libraryVideo('alpha', { movements: [{ still: 'a mirror of mercury', motion: 'ripples breathe', preset: 'P1' }] });
  libraryVideo('beta', { movements: [{ still: 'two panes of glass', motion: 'light flows', preset: 'P2' }], missingEven: true });
  libraryVideo('gamma', { movements: [{ loop: 'alpha/loop-1', reason: 'it belongs', still: 'a mirror of mercury', motion: 'ripples breathe', preset: 'P3' }] });
  const ids = library.loops().map(e => e.id);
  assert.deepStrictEqual(ids, ['alpha/loop-1'], 'beta\'s loop has no file; gamma\'s movement is a reuse, not a loop of its own');
  const gamma = library.videos().find(v => v.slug === 'gamma');
  assert.deepStrictEqual(gamma.loops, ['alpha/loop-1'], 'a reuse counts as a use of the loop it plays');

  let calls = 0;
  const embedText = async () => { calls++; return [3, 4]; };
  const first = await library.embedLoops(library.loops(), { log: () => {}, embedText });
  const second = await library.embedLoops(library.loops(), { log: () => {}, embedText });
  assert.strictEqual(calls, 1, 'embedded once, then read back from the loop\'s record');
  assert.deepStrictEqual(first[0].vector.map(v => +v.toFixed(3)), [0.6, 0.8]);
  assert.deepStrictEqual(second[0].vector.map(v => +v.toFixed(3)), [0.6, 0.8]);
});

test('the shortlist leaves out what the rule forbids and the piece\'s own loops, and penalizes a loop near every piece', () => {
  const entry = (id, vector) => ({ id, vector: unit(vector) });
  const entries = [entry('a/loop-1', [1, 0, 0]), entry('b/loop-1', [0.6, 0, 0.8]), entry('hub/loop-1', [0.7, 0.7, 0]), entry('mine/loop-1', [1, 0, 0])];
  const everyPiece = [unit([1, 0, 0]), unit([0, 1, 0]), unit([0, 0.9, 0.1])];
  const list = library.shortlist({ vector: unit([1, 0.05, 0]), entries, everyPiece, allows: id => id !== 'a/loop-1', slug: 'mine' });
  const ids = list.map(e => e.id);
  assert.ok(!ids.includes('a/loop-1'), 'forbidden by the rule');
  assert.ok(!ids.includes('mine/loop-1'), 'a piece is not offered its own loops');
  const query = unit([1, 0.05, 0]);
  const { dot } = require('../server/lib/utils/vectors');
  assert.ok(dot(query, entries[2].vector) > dot(query, entries[1].vector), 'on closeness alone the hub would lead');
  assert.strictEqual(ids[0], 'b/loop-1', 'with the hub penalty the specific loop leads; the hub, near every piece, falls behind');
});

test('a brief that reuses a loop must take it from the shortlist, give its reason, and reuse at most one', () => {
  const presets = [{ name: 'P1' }, { name: 'P2' }, { name: 'P3' }];
  const open = { presets: reuseRule([], 'preset'), loops: reuseRule([], 'loop') };
  const shortlist = [{ id: 'alpha/loop-1' }, { id: 'beta/loop-2' }];
  const fresh = (preset) => ({ still: 'light', motion: 'it breathes', preset });
  const reply = (movements) => JSON.stringify({ mood: 'm', palette: ['#000000', '#111111', '#222222', '#333333', '#444444'], movements });
  const run = (movements) => check(presets, open, shortlist)(reply(movements)).problems;
  assert.strictEqual(MOVEMENTS, 3);
  assert.deepStrictEqual(run([{ loop: 'alpha/loop-1', reason: 'it belongs', preset: 'P1' }, fresh('P2'), fresh('P3')]), []);
  assert.match(run([{ loop: 'gamma/loop-9', reason: 'r', preset: 'P1' }, fresh('P2'), fresh('P3')]).join(), /was not offered/);
  assert.match(run([{ loop: 'alpha/loop-1', preset: 'P1' }, fresh('P2'), fresh('P3')]).join(), /needs its reason/);
  assert.match(run([{ loop: 'alpha/loop-1', reason: 'r', preset: 'P1' }, { loop: 'beta/loop-2', reason: 'r', preset: 'P2' }, fresh('P3')]).join(), /at most 1 movement/);
});

test('a Short\'s passage is whole lines, 30 to 59 seconds with its lead and tail, and says why', () => {
  // Ten lines of eight seconds, a second apart.
  const lines = Array.from({ length: 10 }, (_, i) => ({ text: `line ${i}`, start: i * 9, end: i * 9 + 8 }));
  const ok = checkPassage({ first: 2, last: 5, why: 'its turn' }, lines, 90);
  assert.deepStrictEqual(ok.problems, []);
  assert.strictEqual(ok.value.start, 17.85);
  assert.strictEqual(ok.value.end, 54.5);
  assert.ok(ok.value.end - ok.value.start >= MIN_SECONDS && ok.value.end - ok.value.start <= MAX_SECONDS);
  assert.match(checkPassage({ first: 2, last: 3, why: 'x' }, lines, 90).problems.join(), /at least 30/);
  assert.match(checkPassage({ first: 0, last: 9, why: 'x' }, lines, 90).problems.join(), /under 59/);
  assert.match(checkPassage({ first: 2, last: 5 }, lines, 90).problems.join(), /why/);
  assert.match(checkPassage({ first: 5, last: 2, why: 'x' }, lines, 90).problems.join(), /line numbers/);
  assert.match(checkPassage({ first: 0, last: 10, why: 'x' }, lines, 90).problems.join(), /line numbers/);
  // The tail never runs past the recording's end.
  assert.strictEqual(checkPassage({ first: 6, last: 9, why: 'x' }, lines, 89).value.end, 89);
});
