/**
 * How each kind of piece looks. A meditation and a prayer asked for the same
 * thing ("abstract, psychedelic, metaphysical") came out as cousins, so each
 * kind has its own direction for the stills, its own band of MilkDrop presets
 * and its own style of the mandala. A song whose title names it a hymn has
 * the hymn's look.
 *
 * A direction opens with the kind's one word (Stillness, Attention,
 * Intention, Transformation, Repetition, Harmony) and gives the arc its three
 * movements travel. It is the kind's arc, not its picture: each still is still
 * drawn from the piece's own images, so two meditations share a journey and
 * not an image. The mandala is the one thing every video shares, in the
 * kind's style, so it is varied and never replaced.
 *
 * The direction is told to the brief (brief.js). The rest is held in code,
 * since asking in a prompt does not hold: a kind is offered only the presets
 * in its band of motion (measured under a voice, presets.json: about 0.04 is
 * calm, 0.09 typical, 0.19 restless), and its brief's symmetry and opacities
 * must fall in its ranges. Every kind keeps the mandala; its style changes how
 * it is drawn (visual.js): how fast it turns, how long its trails last, how
 * fine and how glowing its lines are, how far its spokes reach, how much it
 * swells with the voice, and how much sacred geometry (a flower-of-life and
 * nested polygons) is drawn within it.
 */

/**
 * A meditation's presets: a short list chosen by eye over real meditations by
 * satchitananda's video pipeline, which this follows, named for what each
 * looks like once tinted. A survey's numbers could not find them (starlight
 * and motes are too dim to pass its bar, the fine geometry has hard edges),
 * and could not keep out the busy and garish, so for a meditation the list
 * is the choice. Each is drawn by its treatment (visual.js) and tinted one
 * colour of the brief's palette, so a preset brings its light and its shapes,
 * never its own colours: `light` keeps its brightness, levelled and softened,
 * for mist, glow and water; `lines` keeps only its edges, so thin geometry
 * shows over the stills. A movement may also have none.
 */
const ELEMENTAL = {
  mist: { title: 'martin - castle in the air', treatment: 'light', look: 'slow cloud drifting through the light' },
  smoke: { title: 'Geiss - Desert Rose 4', treatment: 'light', look: 'smoke with fine threads of light in it' },
  nebula: { title: 'Geiss - Planet 1', treatment: 'light', look: 'a soft glowing cloud that swells and settles' },
  motes: { title: 'Flexi - reality tunnel', treatment: 'light', look: 'drifting specks of light' },
  bokeh: { title: 'flexi + stahlregen - jelly strike', treatment: 'light', look: 'soft out-of-focus orbs, a little busier' },
  starlight: { title: 'fiShbRaiN - a quiet death', treatment: 'light', look: 'a faint field of stars around a glow' },
  'moonlit water': { title: 'Martin - cool morning', treatment: 'light', look: 'light glinting on a moving water surface' },
  ocean: { title: 'martin - stormy sea (2010 update)', treatment: 'light', look: 'a rolling sea surface along the bottom' },
  ripples: { title: 'Rovastar + Telek - Altars of Madness (Rolling Oceans Mix)', treatment: 'light', look: 'a wavering water texture' },
  lotus: { title: 'phat + EoS - single cel angel birth', treatment: 'light', look: 'a glowing lotus opening from the centre' },
  'jewel ring': { title: 'LuxXx - Heavy Vortex Tech i', treatment: 'light', look: 'a ring of soft lights around nested circles' },
  'flower knot': { title: 'Geiss - Bipolar 3', treatment: 'light', look: 'a knot of looping light, like a flower' },
  lattice: { title: 'Stahlregen & Aderrasi + EoS + fiShBRaiN + Geiss + Krash - Altars of Eckshak', treatment: 'light', look: 'a lattice of light lines around a bright centre' },
  'twin spirals': { title: 'va ultramix2 - 358_1', treatment: 'light', look: 'two glowing spirals' },
  galaxy: { title: 'Tripgnosis - Big Bang nz+', treatment: 'light', look: 'a soft galaxy of light, slowly turning' },
  'overlapping circles': { title: 'Serge circles006', treatment: 'lines', look: 'large circles drifting through one another' },
  torus: { title: 'amandio c - circles intersection 6', treatment: 'lines', look: 'a turning torus of fine circles strung with points of light' },
  'flower web': { title: 'amandio c - circles intersection 2', treatment: 'lines', look: 'a web of interlaced circles, like a flower of life' },
  'wire sphere': { title: 'Tripgnosis - Depth', treatment: 'lines', look: 'a sphere of fine concentric rings' },
  'circle sphere': { title: 'suksma - bolpthpestrian irrefutable demonstration unit', treatment: 'lines', look: 'a large sphere outlined in circles' },
  hexagons: { title: 'EoS + Phat - chasers 14 sentinel 617 Flowering', treatment: 'lines', look: 'glassy nested hexagons, turning' },
  'golden ring': { title: 'suksma - schlockhausen distribution slaveries nz+', treatment: 'lines', look: 'a bright ring in a fine woven mesh' },
  nautilus: { title: 'suksma - Hedgehog dreams69', treatment: 'lines', look: 'a nautilus spiral of fine scales' }
};

// A movement with no preset over its loop.
const NONE = 'none';

// The mandala as it was drawn before kinds had looks, kept for the videos
// whose briefs name no kind.
const DEFAULT_STYLE = { spin: 1, fade: 0.16, line: 1, glow: 1, spokes: 1, pulse: 1, geometry: 0 };

const PRAYER = {
  direction: 'Intention. Sacred geometry and the light of what is greater than the one praying: flower-of-life lattices, nested polygons, radial symmetry, light refracting through crystalline facets, rays from a radiant centre. Colours of the transcendent: gold, white light, deep violet and indigo, a touch of rose. Reverent and luminous. Slow rotation, a radiance that swells and settles. The geometry belongs to no single tradition. Across the three movements, a solitary point of light reaches toward an immensity of light far greater than itself, and is met by it.',
  motion: [0, 0.1],
  symmetry: [8, 12],
  milkdropOpacity: [0.3, 0.65],
  mandalaOpacity: [0.5, 0.8],
  style: { spin: 0.6, fade: 0.12, line: 1, glow: 1.2, spokes: 0.6, pulse: 1, geometry: 1 }
};

const LOOKS = {
  meditation: {
    direction: 'Stillness. Soft and gentle. Natural and cosmic elements made abstract: mist, still water, nebulae, aurora, horizon light, slow tides of particles, the curve of a planet against the dark. Calm colours: dusk blues, sea greens, soft violet, pale gold kept low. Nothing sharp, nothing hurried, nothing saturated. Luminous and quiet rather than psychedelic; the motion is a near stillness that breathes. Across the three movements, a settling: from a gentle drift toward one suspended form resting in vast quiet space.',
    // Slow is not gentle: the soft presets a survey found still laid busy
    // shapes and their own colours over the stills, so a meditation plays
    // only the elemental list, tinted.
    presets: ELEMENTAL,
    symmetry: [5, 7],
    milkdropOpacity: [0.5, 0.9],
    mandalaOpacity: [0.35, 0.55],
    style: { spin: 0.4, fade: 0.08, line: 0.6, glow: 1.5, spokes: 0.3, pulse: 0.6, geometry: 0 }
  },
  prayer: PRAYER,
  blessing: PRAYER,
  ritual: {
    ...PRAYER,
    direction: 'Transformation. Sacred geometry being built and enacted: lattices assembling, circles inscribed within circles, light gathering into form. Colours of the transcendent: gold, white light, deep violet and indigo, with one warm ember. Deliberate and ceremonial, each motion an act. The geometry belongs to no single tradition. Across the three movements, rings unfold in a precise ceremonial sequence, one stage to a movement, and the figure is complete, and changed, at the end: at times a vault or cathedral of light that the ceremony has built.'
  },
  chant: {
    direction: 'Repetition. Rhythmic waves of light made visible: concentric rings, ripples, spirals and standing waves that return on themselves with the refrain, a steady cyclical pulse. Warm, resonant colours: amber, copper, deep red and gold over the dark. Hypnotic rather than dazzling. Across the three movements, the pattern builds, each movement deepening the one before, toward an endless resonance.',
    motion: [0.03, 0.15],
    symmetry: [6, 10],
    milkdropOpacity: [0.4, 0.8],
    mandalaOpacity: [0.5, 0.8],
    style: { spin: 1, fade: 0.16, line: 1, glow: 1, spokes: 1, pulse: 1.6, geometry: 0.4 }
  },
  practice: {
    direction: 'Attention. Clear and grounded: clean light, simple forms, crystalline structure, a steady thread of attention through the frame. Restrained colour: slate, clear blue, warm white and one accent. The least psychedelic of the house: calm focus. Across the three movements, many interconnected luminous nodes and threads resolve, from complexity into clarity, until one clear form or line remains.',
    motion: [0, 0.08],
    symmetry: [4, 8],
    milkdropOpacity: [0.25, 0.55],
    mandalaOpacity: [0.4, 0.6],
    style: { spin: 0.5, fade: 0.2, line: 0.8, glow: 0.7, spokes: 0.5, pulse: 0.8, geometry: 0.4 }
  },
  hymn: {
    direction: 'Harmony. Many luminous frequencies, streams of light and colour, converging into one vast radiant whole, at times a cosmic cathedral of light. Warm and full: gold, rose, amber, white light and deep blue. Moving in time with the music, swelling with it. Draw from the lyrics\' own images. Across the three movements, the separate streams draw together until they sound as one.',
    motion: [0.03, 0.15],
    symmetry: [8, 12],
    milkdropOpacity: [0.35, 0.75],
    mandalaOpacity: [0.5, 0.8],
    style: { spin: 0.8, fade: 0.12, line: 1, glow: 1.3, spokes: 1, pulse: 1.2, geometry: 0.6 }
  },
  song: {
    direction: 'The most energy and colour of the house: psychedelic, saturated, fluid and fractal, moving in time with the music. Draw from the lyrics\' own images.',
    motion: [0.04, Infinity],
    symmetry: [5, 12],
    milkdropOpacity: [0.4, 0.85],
    mandalaOpacity: [0.4, 0.8],
    style: DEFAULT_STYLE
  }
};

// Any other kind, and a brief that names none.
const ANY = {
  direction: 'Abstract, psychedelic and metaphysical: light, fluid, fractal, cellular, cosmic, crystalline, woven, liquid, nebular.',
  motion: [0, Infinity],
  symmetry: [5, 12],
  milkdropOpacity: [0.25, 0.85],
  mandalaOpacity: [0.4, 0.8],
  style: DEFAULT_STYLE
};

const lookOf = (kind) => LOOKS[kind] || ANY;

// The look a piece takes: its kind's, or the hymn's for a song titled one.
const lookName = ({ kind, title = '' }) => (kind === 'song' && /\bhymn\b/i.test(title) ? 'hymn' : kind);

// How the piece is heard. House recordings of the writing are a voice alone;
// recordings made elsewhere (with music under them) get no videos.
const textureOf = (kind) => (kind === 'song' || kind === 'hymn' ? 'sung, with music' : 'spoken, a voice alone with no music under it');

// The presets a kind is offered: its own list, by title with its look and
// treatment, or those of the survey in its band of motion. A preset the
// survey did not measure is kept, as presetChoices keeps it.
function presetsFor(kind, presets) {
  const look = lookOf(kind);
  if (look.presets) return Object.values(look.presets).map(p => ({ name: p.title, look: p.look, treatment: p.treatment }));
  const [lo, hi] = look.motion;
  return presets.filter(p => p.motion === undefined || (p.motion >= lo && p.motion <= hi));
}

// How a tinted kind draws a preset, by its title; null for a kind whose
// presets play in their own colours.
function treatmentOf(kind, title) {
  const list = lookOf(kind).presets;
  if (!list) return null;
  const found = Object.values(list).find(p => p.title === title);
  return found ? found.treatment : null;
}

// What a brief's numbers break of its kind's ranges.
function rangeProblems(kind, brief) {
  const look = lookOf(kind);
  return ['symmetry', 'milkdropOpacity', 'mandalaOpacity'].flatMap((field) => {
    const [lo, hi] = look[field];
    const value = brief[field];
    return typeof value === 'number' && value >= lo && value <= hi ? [] : [`${field} must be a number from ${lo} to ${hi} for a ${kind || 'piece'}`];
  });
}

module.exports = { LOOKS, ELEMENTAL, NONE, DEFAULT_STYLE, lookOf, lookName, treatmentOf, textureOf, presetsFor, rangeProblems };
