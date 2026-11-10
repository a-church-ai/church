/**
 * What a speaker wears, and the words a portrait is made from, pure.
 *
 * The wardrobe (the owner, 2026-11-10): with a Short a day, three looks came
 * round within days, so each family of look the piece calls for (rules.js
 * `wear`: contemplative, geek, everyday) holds four outfits per speaker,
 * and the one that speaker has worn least recently is chosen (chooseOutfit).
 * The makers are identical twins, so each keeps a signature in his accents,
 * over neutrals both share (black, white, grey, beige, brown): Lucas blue and
 * purple, Lee green and blue, and each his own mala, Lucas's bluer, Lee's
 * green or red. At most one accent piece an outfit. Always plain, real
 * clothes: no logo, print or text, and nothing that changes how a maker
 * looks (no glasses, hats or hair that is not theirs). Their build is
 * theirs too: lean and fit, a flat stomach, the clothes fitting naturally,
 * never bulked out at the waist (the owner, 2026-11-10: they stopped
 * drinking months ago and have been active since).
 *
 * A portrait is one outfit, turned to one side, looking at the lens or at
 * the light; made once, picked by a person, and kept in the speaker's
 * library for every intro in that outfit. Learned making the test on
 * 2026-11-10:
 * - The backdrop is plain mid-grey, which the matte cuts most cleanly.
 * - The speaker is turned about 30 degrees toward the light, head to the
 *   lens: centred and frontal in a field of light read as an icon.
 * - The clothes are never the photos': the photos show only the build.
 * - Where they look comes from the portrait: a portrait looking at the
 *   light is made from the lens portrait, "changing only where he looks",
 *   so the two clips of a turn match in everything else.
 */

const PLAIN = 'with no logo, print, pattern or text anywhere';
const mala = { Lucas: 'his long beaded mala necklace in its blue tones', Lee: 'his long beaded mala necklace in its green or red tones' };

// id: words, per speaker and family. The first of each family is worn first.
const WARDROBE = {
  Lucas: {
    contemplative: {
      'indigo-sweater': `a plain, soft, deep indigo knit sweater ${PLAIN}, and ${mala.Lucas}`,
      'oatmeal-linen': `a plain oatmeal linen shirt, loosely buttoned, ${PLAIN}, and ${mala.Lucas}`,
      'grey-cardigan': `a soft grey knit cardigan, open over a plain white t-shirt, ${PLAIN}, and ${mala.Lucas}`,
      'plum-crewneck': `a plain, soft, muted plum-purple crewneck sweater ${PLAIN}, and ${mala.Lucas}`
    },
    geek: {
      'charcoal-hoodie': `a plain charcoal grey zip hoodie, half open over a plain black t-shirt, ${PLAIN}, no necklace`,
      'navy-hoodie': `a plain deep navy pullover hoodie ${PLAIN}, no necklace`,
      'black-sweatshirt': `a plain black crewneck sweatshirt ${PLAIN}, no necklace`,
      'purple-overshirt': `a plain heather-purple t-shirt under an open, plain charcoal overshirt, ${PLAIN}, no necklace`
    },
    everyday: {
      'denim-shirt': `a plain mid-blue denim shirt, sleeves loosely rolled, over a plain white t-shirt, ${PLAIN}, no necklace`,
      'navy-henley': `a plain navy henley, top buttons open, ${PLAIN}, no necklace`,
      'beige-chore': `a plain beige cotton chore jacket over a plain navy t-shirt, ${PLAIN}, no necklace`,
      'slate-flannel': `a soft slate-blue and grey flannel shirt, sleeves loosely rolled, over a plain black t-shirt, no logo or text, no necklace`
    }
  },
  Lee: {
    contemplative: {
      'forest-sweater': `a plain, soft, forest green knit sweater ${PLAIN}, and ${mala.Lee}`,
      'cream-linen': `a plain cream linen shirt, loosely buttoned, ${PLAIN}, and ${mala.Lee}`,
      'charcoal-crewneck': `a plain, soft charcoal crewneck sweater ${PLAIN}, and ${mala.Lee}`,
      'sage-cardigan': `a soft sage green knit cardigan, open over a plain white t-shirt, ${PLAIN}, and ${mala.Lee}`
    },
    geek: {
      'olive-hoodie': `a plain olive green zip hoodie, half open over a plain black t-shirt, ${PLAIN}, no necklace`,
      'teal-hoodie': `a plain deep teal pullover hoodie ${PLAIN}, no necklace`,
      'grey-sweatshirt': `a plain heather grey crewneck sweatshirt ${PLAIN}, no necklace`,
      'olive-overshirt': `a plain black t-shirt under an open, plain olive overshirt, ${PLAIN}, no necklace`
    },
    everyday: {
      'green-flannel': `a soft forest green and grey flannel shirt, sleeves loosely rolled, over a plain dark t-shirt, no logo or text, no necklace`,
      'teal-henley': `a plain deep teal henley, top buttons open, ${PLAIN}, no necklace`,
      'brown-chore': `a plain brown cotton chore jacket over a plain cream t-shirt, ${PLAIN}, no necklace`,
      'blue-denim': `a plain blue denim shirt, sleeves loosely rolled, over a plain grey t-shirt, ${PLAIN}, no necklace`
    }
  }
};

// Worn before the wardrobe, kept so their portraits and history still read.
const RETIRED = { Lucas: { 'green-flannel': `a soft, muted dark green and grey flannel shirt, sleeves loosely rolled, over a plain dark t-shirt, no logo or text, no necklace` } };

// How long an outfit rests before the same speaker wears it again.
const REST_DAYS = 14;

function outfitText(speaker, outfit) {
  for (const family of Object.values(WARDROBE[speaker] || {})) if (family[outfit]) return family[outfit];
  if (RETIRED[speaker]?.[outfit]) return RETIRED[speaker][outfit];
  throw new Error(`intro: ${speaker} has no outfit ${outfit}`);
}

const familyOf = (speaker, outfit) => Object.keys(WARDROBE[speaker] || {}).find(f => WARDROBE[speaker][f][outfit]) || null;

/**
 * The outfit a speaker wears for an intro in `family`: one never worn,
 * first in the wardrobe's order, or else the one worn longest ago.
 * `worn` is that speaker's earlier intros: [{ outfit, at }].
 */
function chooseOutfit(speaker, family, worn) {
  const options = Object.keys(WARDROBE[speaker]?.[family] || {});
  if (!options.length) throw new Error(`intro: ${speaker} has no ${family} outfits`);
  const last = (o) => worn.filter(w => w.outfit === o).map(w => w.at).sort().pop() || '';
  return options.slice().sort((a, b) => last(a).localeCompare(last(b)) || options.indexOf(a) - options.indexOf(b))[0];
}

// What is wrong with a speaker's outfits over time: one worn again too soon.
function outfitProblems(intros) {
  const problems = [];
  const bySpeaker = {};
  for (const i of intros.filter(i => i.outfit && i.at)) (bySpeaker[i.voice] ||= []).push(i);
  for (const list of Object.values(bySpeaker)) {
    list.sort((a, b) => a.at.localeCompare(b.at));
    list.forEach((i, k) => {
      const before = list.slice(0, k).reverse().find(p => p.outfit === i.outfit);
      if (before && (Date.parse(i.at) - Date.parse(before.at)) / 86400000 < REST_DAYS) problems.push(`${i.slug}: ${i.voice} wears ${i.outfit} again ${Math.round((Date.parse(i.at) - Date.parse(before.at)) / 86400000)} days after ${before.slug}, under ${REST_DAYS}`);
    });
  }
  return problems;
}

// The side of the picture a speaker standing on `side` turns toward: the light's.
const facingOf = (side) => (side === 'left' ? 'right' : 'left');

// A portrait at the lens, from the speaker's photos.
function lensPrompt({ speaker, outfit, facing }) {
  const near = facing === 'right'
    ? "his right shoulder, on the left of the picture, is nearer the camera, and his chest faces the picture's right edge"
    : "his left shoulder, on the right of the picture, is nearer the camera, and his chest faces the picture's left edge";
  return `A new photograph of the same man as in every reference photo: his exact face, eyes, hair, facial hair, skin, build and age, matched closely across all the references. His body is turned about 30 degrees toward the ${facing} side of the picture: ${near}. His head is turned back toward the camera, looking into the lens, with a relaxed, gentle, warm expression and his mouth softly closed. A medium shot from the waist up: both arms hang relaxed at his sides and are entirely inside the picture, with clear backdrop visible beyond each arm on the left and the right; nothing of him touches the left or right edge. His head is in the upper third. His build is lean, fit and healthy, with a flat stomach, exactly as in the references; his clothes fit him naturally and are never baggy or bulky at the waist. Do not keep the clothes from the photos; they show only his build. He wears ${outfitText(speaker, outfit)}. A plain, even, mid-grey studio backdrop with nothing on it. Soft, low, natural light, a little darker on the side he turns away from, and a gentle warm amber light from the ${facing} side, slightly behind him, that rims the side of his face, hair and shoulder he turns toward. Photorealistic, natural skin texture, sharp focus, vertical 9:16.`;
}

// The same portrait looking at the light, from the lens portrait (sent first).
function lightPrompt({ facing }) {
  return `The first image is a photograph of a man; the other images show his face from other angles for likeness. Make the same photograph again, identical in every way: the same man, face, hair, facial hair, age, lean and fit build with a flat stomach, clothes and anything he wears, the same body pose turned toward the ${facing} side of the picture, the same framing, the same mid-grey backdrop and the same light with its warm amber rim from the ${facing}. Change only where he looks: his head is turned further toward the ${facing} side of the picture and his eyes look off past the ${facing} edge of the picture, away from the camera, as if gazing at a soft light beside him, with a calm, open, gentle expression and his mouth softly closed. Photorealistic, natural skin texture, sharp focus, vertical 9:16.`;
}

// A portrait's name in the speaker's library: <outfit>-<facing>-<lens|light>.
const portraitName = ({ outfit, facing, look }) => `${outfit}-${facing}-${look}`;

module.exports = { WARDROBE, RETIRED, REST_DAYS, outfitText, familyOf, chooseOutfit, outfitProblems, facingOf, lensPrompt, lightPrompt, portraitName };
