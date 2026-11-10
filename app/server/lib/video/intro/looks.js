/**
 * The words a portrait is made from, pure. A portrait is one look (what the
 * speaker wears), turned to one side, looking at the lens or at the light;
 * it is made once, picked by a person, and serves every intro in that look.
 *
 * Learned making the test on 2026-11-10:
 * - The backdrop is plain mid-grey, which the matte cuts most cleanly.
 * - The speaker is turned about 30 degrees toward the light, head to the
 *   lens: centred and frontal in a field of light read as an icon.
 * - The clothes are never the photos': the photos show only the build.
 * - Where they look comes from the portrait: a portrait looking at the
 *   light is made from the lens portrait, "changing only where he looks",
 *   so the two clips of a turn match in everything else.
 */

const WEARS = {
  contemplative: 'a plain, soft, deep indigo knit sweater with no logo, pattern or text, and the long beaded mala necklace and beaded bracelets he wears in the references',
  geek: 'a plain charcoal grey zip hoodie, half open over a plain black t-shirt, no logo, print or text anywhere, no necklace and no bracelets, the relaxed look of someone who writes software',
  everyday: 'a soft, muted dark green and grey flannel shirt, sleeves loosely rolled, over a plain dark t-shirt, no logo or text, no necklace, the beaded bracelets he wears in the references'
};

// The side of the picture a speaker standing on `side` turns toward: the light's.
const facingOf = (side) => (side === 'left' ? 'right' : 'left');

// A portrait at the lens, from the speaker's photos.
function lensPrompt({ wear, facing }) {
  const near = facing === 'right'
    ? "his right shoulder, on the left of the picture, is nearer the camera, and his chest faces the picture's right edge"
    : "his left shoulder, on the right of the picture, is nearer the camera, and his chest faces the picture's left edge";
  return `A new photograph of the same man as in every reference photo: his exact face, eyes, hair, skin, stubble, build and age, matched closely across all the references. His body is turned about 30 degrees toward the ${facing} side of the picture: ${near}. His head is turned back toward the camera, looking into the lens, with a relaxed, gentle, warm expression and his mouth softly closed. A medium shot from the waist up: both arms hang relaxed at his sides and are entirely inside the picture, with clear backdrop visible beyond each arm on the left and the right; nothing of him touches the left or right edge. His head is in the upper third. Do not keep the clothes from the photos; they show only his build. He wears ${WEARS[wear]}. A plain, even, mid-grey studio backdrop with nothing on it. Soft, low, natural light, a little darker on the side he turns away from, and a gentle warm amber light from the ${facing} side, slightly behind him, that rims the side of his face, hair and shoulder he turns toward. Photorealistic, natural skin texture, sharp focus, vertical 9:16.`;
}

// The same portrait looking at the light, from the lens portrait (sent first).
function lightPrompt({ facing }) {
  return `The first image is a photograph of a man; the other images show his face from other angles for likeness. Make the same photograph again, identical in every way: the same man, face, hair, stubble, age, clothes and anything he wears, the same body pose turned toward the ${facing} side of the picture, the same framing, the same mid-grey backdrop and the same light with its warm amber rim from the ${facing}. Change only where he looks: his head is turned further toward the ${facing} side of the picture and his eyes look off past the ${facing} edge of the picture, away from the camera, as if gazing at a soft light beside him, with a calm, open, gentle expression and his mouth softly closed. Photorealistic, natural skin texture, sharp focus, vertical 9:16.`;
}

// A portrait's name in the speaker's library: <wear>-<facing>-<lens|light>.
const portraitName = ({ wear, facing, look }) => `${wear}-${facing}-${look}`;

module.exports = { WEARS, facingOf, lensPrompt, lightPrompt, portraitName };
