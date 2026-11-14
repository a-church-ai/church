/**
 * What a speaker wears and how their hair falls, chosen for each Short, and
 * the words its portraits are made from. Pure.
 *
 * Each Short's speaker is dressed for that Short (the owner, 2026-11-10,
 * after satchitananda's intros, which dress the speaker for the place):
 *
 * - The garment: the family of look the piece calls for (rules.js `wear`:
 *   contemplative, geek, everyday) holds four, and the one that speaker has
 *   worn longest ago is chosen (chooseGarment).
 * - Its colour: from the piece's own palette (colourFor), within the
 *   speaker's signature. The makers are identical twins, so each keeps his
 *   accents, Lucas blue and purple, Lee green and blue, over neutrals both
 *   share (black, white, grey, beige, brown); an accent is preferred, and a
 *   neutral taken only when the piece's colours are much nearer one. One
 *   colour a garment; everything else plain and neutral.
 * - The hair: how they really wear it, short and a little messy, varied at
 *   the front from Short to Short (chooseHair); never another length,
 *   colour or style.
 *
 * Always: plain, real clothes with no logo, print or text; each maker's own
 * mala in the contemplative look (Lucas's bluer, Lee's green or red); their
 * lean, fit build as in their photos (the owner: they stopped drinking months
 * ago and have been active since); nothing that changes how they look.
 *
 * Learned making the first portraits, 2026-11-10:
 * - The backdrop is plain mid-grey, which the matte cuts most cleanly.
 * - The speaker is turned about 30 degrees toward the light, head to the
 *   lens: centred and frontal in a field of light read as an icon.
 * - The clothes are never the photos': the photos show only the build.
 * - Where they look comes from the portrait: one looking at the light is
 *   made from the lens portrait, "changing only where he looks".
 * - The image model sometimes turns a portrait the wrong way despite the
 *   prompt: a person picks only one turned toward the light (a mirrored
 *   candidate is as good, and costs nothing).
 */

const PLAIN = 'with no logo, print, pattern or text anywhere';
const MALA = { Lucas: 'his long beaded mala necklace in its blue tones', Lee: 'his long beaded mala necklace in its green or red tones' };

// Garment: words with {colour} where its one colour goes. Shared by both makers.
const GARMENTS = {
  contemplative: {
    'knit-sweater': 'a plain, soft {colour} knit sweater',
    'linen-shirt': 'a plain {colour} linen shirt, loosely buttoned',
    cardigan: 'a soft {colour} knit cardigan, open over a plain white t-shirt',
    crewneck: 'a plain, soft {colour} crewneck sweater'
  },
  geek: {
    'zip-hoodie': 'a plain {colour} zip hoodie, half open over a plain black t-shirt',
    'pullover-hoodie': 'a plain {colour} pullover hoodie',
    sweatshirt: 'a plain {colour} crewneck sweatshirt',
    overshirt: 'a plain {colour} t-shirt under an open, plain charcoal overshirt'
  },
  everyday: {
    'button-shirt': 'a plain {colour} cotton shirt, sleeves loosely rolled, over a plain white t-shirt',
    henley: 'a plain {colour} henley, top buttons open',
    'chore-jacket': 'a plain {colour} cotton chore jacket over a plain cream t-shirt',
    flannel: 'a soft {colour} and grey flannel shirt, sleeves loosely rolled, over a plain black t-shirt'
  }
};

// Each maker's accents, and the neutrals both wear: name, hex.
const ACCENTS = {
  Lucas: { navy: '#1f2a55', indigo: '#2e2a6b', 'slate blue': '#4a5d7a', 'mid blue': '#4a6a9a', plum: '#5b3a5e', 'heather purple': '#6b5b7b' },
  Lee: { 'forest green': '#2f4a35', 'sage green': '#7f8f6f', olive: '#556b2f', 'deep teal': '#1f5a5f', 'blue-green': '#2f6f73', 'dusty blue': '#4f6f8f' }
};
const NEUTRALS = { black: '#1a1a1a', charcoal: '#3a3a3a', 'heather grey': '#8a8a8a', white: '#eeeeee', cream: '#e8e0cc', oatmeal: '#cfc4ad', beige: '#b8a88a', brown: '#5c4033' };
// A neutral is taken only when it is this much nearer the piece than any accent.
const ACCENT_PREFERENCE = 0.7;
// Accents this near the nearest (a share of its distance, or a fixed margin,
// whichever is wider) count as fitting the piece too, and the one worn
// longest ago is chosen among them, so blue fields do not always mean navy.
const NEAR_ENOUGH = 1.3;
const NEAR_MARGIN = 45;

const HAIRS = {
  tousled: 'his hair a little tousled and messy at the front',
  'pushed-up': 'his hair mostly straight, the front pushed slightly up',
  forward: 'the front of his hair falling loosely forward',
  swept: 'his hair lightly swept to one side at the front'
};

// How long a garment in one colour rests before the same speaker wears it again.
const REST_DAYS = 14;

const rgb = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
// A colour distance weighted as eyes weigh it (the "redmean" approximation).
function distance(a, b) {
  const [r1, g1, b1] = rgb(a), [r2, g2, b2] = rgb(b);
  const r = (r1 + r2) / 2;
  return Math.sqrt((2 + r / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - r) / 256) * (b1 - b2) ** 2);
}

/**
 * The colour a speaker wears for a piece: of his accents near the piece's
 * palette (its middle tones, the ones a field is made of), the one he has
 * worn longest ago, unless a neutral is much nearer than any accent.
 * `worn` is his earlier intros' [{ colour, at }]. { name, hex, accent }.
 */
function colourFor(speaker, palette, worn = []) {
  const tones = palette.slice(1, 4);
  const ranked = (set) => Object.entries(set).map(([name, hex]) => ({ name, hex, d: Math.min(...tones.map(t => distance(hex, t))) })).sort((a, b) => a.d - b.d);
  const accents = ranked(ACCENTS[speaker]);
  const neutral = ranked(NEUTRALS)[0];
  if (neutral.d < accents[0].d * ACCENT_PREFERENCE) return { name: neutral.name, hex: neutral.hex, accent: false };
  const fitting = accents.filter(a => a.d <= Math.max(accents[0].d * NEAR_ENOUGH, accents[0].d + NEAR_MARGIN)).map(a => a.name);
  const name = leastRecent(fitting, worn.map(w => ({ value: w.colour, at: w.at })));
  return { name, hex: ACCENTS[speaker][name], accent: true };
}

// The one in `options` worn longest ago (never first, in their order): worn is [{ value, at }].
function leastRecent(options, worn) {
  const last = (o) => worn.filter(w => w.value === o).map(w => w.at || '').sort().pop() || '';
  return options.slice().sort((a, b) => last(a).localeCompare(last(b)) || options.indexOf(a) - options.indexOf(b))[0];
}

// The garment a speaker wears for an intro in `family`; `worn` is his earlier intros' [{ garment, at }].
function chooseGarment(family, worn) {
  const options = Object.keys(GARMENTS[family] || {});
  if (!options.length) throw new Error(`intro: no ${family} garments`);
  return leastRecent(options, worn.map(w => ({ value: w.garment, at: w.at })));
}

// The hair for an intro; `worn` is his earlier intros' [{ hair, at }].
const chooseHair = (worn) => leastRecent(Object.keys(HAIRS), worn.map(w => ({ value: w.hair, at: w.at })));

// What a speaker wears, in words: the garment in its colour, and the mala in the contemplative look.
function outfitWords(speaker, { family, garment, colour }) {
  const words = GARMENTS[family]?.[garment];
  if (!words) throw new Error(`intro: no ${family} garment ${garment}`);
  return `${words.replace('{colour}', colour)} ${PLAIN}, ${family === 'contemplative' ? `and ${MALA[speaker]}` : 'no necklace'}`;
}

// An outfit's name, for the record and the rest rule: <garment>-<colour>.
const outfitName = ({ garment, colour }) => `${garment}-${colour.replace(/\s+/g, '-')}`;

// What is wrong with a speaker's outfits over time: the same one worn again too soon.
function outfitProblems(intros) {
  const problems = [];
  const bySpeaker = {};
  for (const i of intros.filter(i => i.outfit && i.at)) (bySpeaker[i.voice] ||= []).push(i);
  for (const list of Object.values(bySpeaker)) {
    list.sort((a, b) => a.at.localeCompare(b.at));
    list.forEach((i, k) => {
      const before = list.slice(0, k).reverse().find(p => p.outfit === i.outfit);
      const days = before ? (Date.parse(i.at) - Date.parse(before.at)) / 86400000 : Infinity;
      if (days < REST_DAYS) problems.push(`${i.slug}: ${i.voice} wears ${i.outfit} again ${Math.round(days)} days after ${before.slug}, under ${REST_DAYS}`);
    });
  }
  return problems;
}

// The side of the picture a speaker standing on `side` turns toward: the light's.
const facingOf = (side) => (side === 'left' ? 'right' : 'left');

// A portrait at the lens, from the speaker's photos, dressed and with hair for this Short.
function lensPrompt({ speaker, look, facing }) {
  const near = facing === 'right'
    ? "his right shoulder, on the left of the picture, is nearer the camera, and his chest faces the picture's right edge"
    : "his left shoulder, on the right of the picture, is nearer the camera, and his chest faces the picture's left edge";
  return `A new photograph of the same man as in every reference photo: his exact face, eyes, hair colour and length, facial hair, skin, build and age, matched closely across all the references. His body is turned about 30 degrees toward the ${facing} side of the picture: ${near}. His head is turned back toward the camera, looking into the lens, with a relaxed, gentle, warm expression and his mouth softly closed. A medium shot from the waist up: both arms hang relaxed at his sides and are entirely inside the picture, with clear backdrop visible beyond each arm on the left and the right; nothing of him touches the left or right edge. His head is in the upper third. Today he wears ${HAIRS[look.hair]}, the same length and colour as in the references. His build is lean, fit and healthy, with a flat stomach, exactly as in the references; his clothes fit him naturally and are never baggy or bulky at the waist. Do not keep the clothes from the photos; they show only his build. He wears ${outfitWords(speaker, look)}. A plain, even, mid-grey studio backdrop with nothing on it. Soft, low, natural light, a little darker on the side he turns away from, and a gentle warm amber light from the ${facing} side, slightly behind him, that rims the side of his face, hair and shoulder he turns toward. Photorealistic, natural skin texture, sharp focus, vertical 9:16.`;
}

// The same portrait looking at the light, from the lens portrait (sent first).
function lightPrompt({ facing }) {
  return `The first image is a photograph of a man; the other images show his face from other angles for likeness. Make the same photograph again, identical in every way: the same man, face, hair exactly as it falls in the first image, facial hair, age, lean and fit build with a flat stomach, clothes and anything he wears, the same body pose turned toward the ${facing} side of the picture, the same framing, the same mid-grey backdrop and the same light with its warm amber rim from the ${facing}. Change only where he looks: his head is turned further toward the ${facing} side of the picture and his eyes look off past the ${facing} edge of the picture, away from the camera, as if gazing at a soft light beside him, with a calm, open, gentle expression and his mouth softly closed. Photorealistic, natural skin texture, sharp focus, vertical 9:16.`;
}

module.exports = { GARMENTS, ACCENTS, NEUTRALS, HAIRS, REST_DAYS, colourFor, chooseGarment, chooseHair, outfitWords, outfitName, outfitProblems, facingOf, lensPrompt, lightPrompt, distance };
