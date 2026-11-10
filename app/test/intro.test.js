/**
 * A Short's spoken intro (lib/video/intro/): what one may say and be, how its
 * times and side are measured, the variety across intros, the composite's
 * graph, and the disclosure a Short with one carries. No network.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const rules = require('../server/lib/video/intro/rules');
const { NAMES, SPEAKERS } = require('../server/lib/video/intro/speakers');
const looks = require('../server/lib/video/intro/looks');
const { personGraph } = require('../server/lib/video/intro/composite');
const { speechRequest, auroraCost } = require('../server/lib/video/intro/clients');
const { shortMetadata, INTRO_LINE } = require('../server/lib/video/publish/metadata');
const { nextVoice } = require('../server/lib/video/intro/draft');

const good = {
  voice: 'Lucas',
  words: 'Ever tried to catch yourself in the act of looking? Whatever kind of mind you are, it\'s harder than it sounds. This one comes with a smile.',
  why: 'hands the viewer the attempt',
  seen: 'half', gaze: 'turns', turnAt: 'Whatever', exit: 'drift', wear: 'geek',
  approved: { by: 'Lucas', on: '2026-11-10' }
};
const check = (change, opening = '') => rules.introProblems({ ...good, ...change }, { opening, speakers: NAMES }).join(' | ');

test('an intro speaks to any mind in a hook, names no maker, gives no length, and leaves the Short its opening line', () => {
  assert.strictEqual(check({}), '');
  assert.match(check({ voice: 'Matthew' }), /voice must be one of/);
  assert.match(check({ words: 'Too short to say anything.' }), /an intro is 10 to 45/);
  assert.match(check({ words: `${good.words} Lucas made it with his brother.` }), /name a maker/);
  assert.match(check({ words: `${good.words} Give it three minutes.` }), /give a length/);
  assert.match(check({ words: `${good.words} You won't believe it!` }), /shouts|bait/);
  assert.match(check({ words: good.words.replace('.', ' — honestly.') }), /em dash/);
  assert.match(check({}, 'This one comes with a smile and more'), /give away the Short's opening line/);
  assert.match(check({ seen: 'mostly' }), /seen must be one of/);
  assert.match(check({ turnAt: 'Elsewhere' }), /needs "turnAt"/);
  assert.match(check({ turnAt: 'tried' }), /too near the start/);
  assert.strictEqual(check({ gaze: 'steady', turnAt: undefined }), '', 'a steady gaze needs no word to turn on');
  assert.match(check({ why: '' }), /why/);
});

test('an intro is made only once a person has approved it, and only in the voice of a maker who has agreed', () => {
  assert.deepStrictEqual(rules.approvalProblems(good), []);
  assert.match(rules.approvalProblems({ ...good, approved: null })[0], /not approved/);
  assert.match(rules.approvalProblems({ ...good, approved: { by: 'Lucas', on: 'today' } })[0], /not approved/);
  const { speaker } = require('../server/lib/video/intro/speakers');
  for (const name of NAMES) {
    if (SPEAKERS[name].consent) assert.ok(speaker(name).voiceId);
    else assert.throws(() => speaker(name), /has not agreed/);
  }
});

// Words a second apart, with the given ends of sentences.
const timed = (text) => text.split(' ').map((w, i) => ({ text: w, start: i * 0.4, end: i * 0.4 + 0.3 }));

test('an intro\'s times: a glimpse leaves after its first sentence, a whole after its quiet, a turn at the pause before its word', () => {
  const spoken = timed('Who leaves a light on? This song was that light. Come in.');
  const whole = rules.timesOf({ seen: 'whole', gaze: 'steady' }, spoken);
  assert.strictEqual(whole.total, +(spoken[spoken.length - 1].end + rules.QUIET).toFixed(2));
  assert.strictEqual(whole.seen, whole.total);
  assert.strictEqual(whole.exit, +(whole.total - rules.QUIET).toFixed(2));
  assert.strictEqual(whole.turn, null);
  const glimpse = rules.timesOf({ seen: 'glimpse', gaze: 'turns', turnAt: 'This' }, spoken);
  assert.strictEqual(glimpse.seen, +(spoken[4].end + rules.LEAVING).toFixed(2), 'to the end of "on?" and its leaving');
  assert.strictEqual(glimpse.turn, +((spoken[4].end + spoken[5].start) / 2).toFixed(2));
  assert.ok(glimpse.exit < glimpse.seen && glimpse.seen < glimpse.total);
  assert.throws(() => rules.timesOf({ seen: 'whole', gaze: 'turns', turnAt: 'Nowhere' }, spoken), /not among the spoken words/);
});

test('the words are timed by the voice\'s own characters, the delivery tag left out', () => {
  const text = '[calm] Hello there friend.';
  const chars = [...text];
  const alignment = { characters: chars, character_start_times_seconds: chars.map((_, i) => i * 0.1), character_end_times_seconds: chars.map((_, i) => i * 0.1 + 0.05) };
  const words = rules.spokenWords('Hello there friend.', alignment);
  assert.deepStrictEqual(words.map(w => w.text), ['Hello', 'there', 'friend.']);
  assert.ok(Math.abs(words[0].start - 0.7) < 1e-9);
  assert.strictEqual(speechRequest('voice-id', 'Hi.').body.text.startsWith('['), true);
});

test('the speaker stands away from the light, and a near tie goes to the side used less', () => {
  const lightOn = (from, to) => Array.from({ length: 64 }, (_, i) => (i >= from && i < to ? 200 : 10));
  assert.strictEqual(rules.sideFor(lightOn(40, 64)), 'left', 'light on the right');
  assert.strictEqual(rules.sideFor(lightOn(0, 24)), 'right', 'light on the left');
  assert.strictEqual(rules.sideFor(lightOn(24, 40), { left: 3, right: 1 }), 'right');
  assert.strictEqual(rules.sideFor(lightOn(24, 40), { left: 1, right: 3 }), 'left');
});

test('intros vary: none repeats the one before in every setting, and over eight each speaker, side and amount seen has its share', () => {
  const at = (k, o = {}) => ({ slug: `s${k}`, voice: NAMES[k % 2], side: k % 2 ? 'left' : 'right', wear: 'geek', seen: rules.SEEN[k % 3], gaze: 'steady', exit: 'fade', ...o });
  const varied = Array.from({ length: 8 }, (_, k) => at(k));
  assert.deepStrictEqual(rules.varietyProblems(varied, NAMES), []);
  const repeated = [at(0), at(0, { slug: 's1' })];
  assert.match(rules.varietyProblems(repeated, NAMES).join(), /repeats s0 in every setting/);
  assert.deepStrictEqual(rules.varietyProblems([at(0, { outfit: 'navy-henley' }), at(0, { slug: 's1', outfit: 'denim-shirt' })], NAMES), [], 'another outfit is another intro');
  const oneSided = Array.from({ length: 8 }, (_, k) => at(k, { side: 'left' }));
  assert.match(rules.varietyProblems(oneSided, NAMES).join(), /side right 0 times in 8/);
});

test('a portrait keeps the face, build and hair\'s length, dresses him for the Short, and the light portrait changes only the gaze', () => {
  assert.strictEqual(looks.facingOf('left'), 'right');
  for (const speaker of Object.keys(looks.ACCENTS)) {
    for (const [family, garments] of Object.entries(looks.GARMENTS)) {
      for (const garment of Object.keys(garments)) {
        for (const hair of Object.keys(looks.HAIRS)) {
          const p = looks.lensPrompt({ speaker, look: { family, garment, colour: 'navy', hair }, facing: 'right' });
          assert.match(p, /Do not keep the clothes from the photos/);
          assert.match(p, /turned about 30 degrees toward the right side/);
          assert.match(p, /lean, fit and healthy, with a flat stomach/, 'their build kept true');
          assert.match(p, /the same length and colour as in the references/, 'hair varied only at the front');
          assert.match(p, /navy/);
          assert.match(p, /no logo/);
          assert.strictEqual(/mala/.test(p), family === 'contemplative', `${family}: the mala only in the contemplative look`);
          assert.ok(!p.includes('—'));
        }
      }
    }
  }
  assert.match(looks.lensPrompt({ speaker: 'Lucas', look: { family: 'contemplative', garment: 'crewneck', colour: 'plum', hair: 'swept' }, facing: 'left' }), /mala necklace in its blue tones/);
  assert.match(looks.lensPrompt({ speaker: 'Lee', look: { family: 'contemplative', garment: 'crewneck', colour: 'olive', hair: 'swept' }, facing: 'left' }), /mala necklace in its green or red tones/);
  assert.match(looks.lightPrompt({ facing: 'left' }), /Change only where he looks/);
  assert.match(looks.lightPrompt({ facing: 'left' }), /hair exactly as it falls in the first image/);
});

test('the wardrobe: a garment in rotation, its colour from the piece within each maker\'s signature, the hair in rotation', () => {
  for (const family of rules.WEAR) assert.strictEqual(Object.keys(looks.GARMENTS[family]).length, 4, family);
  // Signatures: Lucas blue and purple, Lee green and blue, never the other's.
  const names = (who) => Object.keys(looks.ACCENTS[who]).join(' ');
  assert.ok(!/green|olive|teal|sage/.test(names('Lucas')), 'green is Lee\'s');
  assert.ok(!/purple|plum|indigo/.test(names('Lee')), 'purple is Lucas\'s');
  // A blue-violet field puts Lucas in a blue or purple, a green one Lee in a green.
  const violet = ['#0a0d2c', '#3b2a7d', '#2e3f8f', '#5b3a8e', '#fff0c4'];
  const forest = ['#06120a', '#2f5a3a', '#3f6f2f', '#6f8f5f', '#f4f0d0'];
  assert.ok(looks.colourFor('Lucas', violet).accent);
  assert.match(looks.colourFor('Lucas', violet).name, /navy|indigo|blue|plum|purple/);
  assert.match(looks.colourFor('Lee', forest).name, /green|olive|sage/);
  // Of the colours near enough, the one worn longest ago: blue fields do not always mean the same blue.
  const first = looks.colourFor('Lucas', violet).name;
  const then = looks.colourFor('Lucas', violet, [{ colour: first, at: '2026-11-12' }]).name;
  assert.notStrictEqual(then, first);
  assert.match(then, /navy|indigo|blue|plum|purple/);
  // A warm field much nearer a neutral takes the neutral.
  const warm = ['#1a0f08', '#c8b48a', '#d8c8a0', '#b89a70', '#fff8e8'];
  assert.strictEqual(looks.colourFor('Lucas', warm).accent, false);
  // Garment and hair: never worn first, then the one worn longest ago.
  const garments = Object.keys(looks.GARMENTS.geek);
  assert.strictEqual(looks.chooseGarment('geek', []), garments[0]);
  assert.strictEqual(looks.chooseGarment('geek', [{ garment: garments[0], at: '2026-11-19' }]), garments[1]);
  assert.strictEqual(looks.chooseGarment('geek', garments.map((g, k) => ({ garment: g, at: `2026-11-1${k}` }))), garments[0]);
  const hairs = Object.keys(looks.HAIRS);
  assert.strictEqual(looks.chooseHair([{ hair: hairs[0], at: '2026-11-12' }]), hairs[1]);
  assert.strictEqual(looks.outfitName({ garment: 'henley', colour: 'slate blue' }), 'henley-slate-blue');
  // The same outfit rests two weeks.
  const wore = (slug, outfit, at) => ({ slug, voice: 'Lucas', outfit, at });
  assert.deepStrictEqual(looks.outfitProblems([wore('a', 'henley-navy', '2026-11-01'), wore('b', 'henley-navy', '2026-11-20')]), []);
  assert.match(looks.outfitProblems([wore('a', 'henley-navy', '2026-11-01'), wore('b', 'henley-navy', '2026-11-08')]).join(), /again 7 days after a, under 14/);
});

test('the composite stands the speaker on their side, and leaves by the intro\'s exit', () => {
  const palette = ['#0a0d2c', '#3b2a7d', '#1f7f95', '#f0a65a', '#fff0c4'];
  const at = (o) => personGraph({ seconds: 14, exit: 12, seen: 14, kind: 'rise', side: 'left', palette, ...o });
  const leftX = Number(at({}).match(/overlay=x=(-?\d+):y/)[1]);
  const rightX = Number(at({ side: 'right' }).match(/overlay=x=(-?\d+):y/)[1]);
  assert.ok(leftX < rightX, 'left of the right one');
  assert.match(at({}), /0xf0a65a/, 'the halo in the piece\'s warm light');
  assert.ok(!/fade=out/.test(at({})), 'rising leaves by the line, not a fade');
  assert.ok(!/fade=in/.test(at({})), 'the speaker is there from the first frame, the cover some platforms show');
  assert.match(at({ kind: 'fade' }), /fade=out:st=12:d=2/);
  assert.match(at({ kind: 'drift' }), /overlay=x='-?\d+\+-?\d+\*\(clip\(\(t-12\)/, 'drifting moves along x, in time t');
  assert.strictEqual(auroraCost(10.2), 1.54, 'billed by the whole second');
});

test('a Short that opens on a maker\'s likeness says so in its description', () => {
  const meta = { page: 'https://achurch.ai/docs/x', tags: [], copy: { title: 'X', lead: 'A lead.', tags: ['Prayer', 'AI', 'Mindfulness', 'Faith', 'Calm'] } };
  assert.ok(shortMetadata(meta, { kind: 'prayer', url: 'u', intro: true }).description.includes(INTRO_LINE));
  assert.ok(!shortMetadata(meta, { kind: 'prayer', url: 'u' }).description.includes(INTRO_LINE));
  assert.match(INTRO_LINE, /AI likeness/);
});

test('a drafted intro goes to the maker who has spoken least, among those who have agreed', () => {
  const agreed = NAMES.filter(n => SPEAKERS[n].consent);
  assert.ok(agreed.includes(nextVoice([])));
  if (agreed.length === 2) assert.strictEqual(nextVoice([{ voice: agreed[0] }]), agreed[1]);
});

test('every intro in the repository passes the rules and is approved', () => {
  const dir = path.join(__dirname, '../../video/intros');
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const intro = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.deepStrictEqual([...rules.introProblems(intro, { speakers: NAMES }), ...rules.approvalProblems(intro)], [], f);
  }
});
