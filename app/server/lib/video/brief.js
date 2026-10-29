/**
 * A piece's visual brief: what its video looks like, written by Claude from
 * the piece's own words. Three movements, each with a still to animate into
 * an eight-second loop and a MilkDrop preset to play over it, and the palette
 * and symmetry the house's own effects layer draws in.
 *
 * Abstract, psychedelic and metaphysical by design: no buildings, symbols of
 * any one faith, faces or figures, and no text, which image and video models
 * render as nonsense.
 *
 * Neither Claude nor the video model hears the recording (the model accepts
 * no reference audio), so the brief is told what each movement sounds like:
 * how much of it is voiced, its pauses, its loudness and which way it moves,
 * and for a song its tempo. The motion is written to fit, with timecodes
 * inside the eight seconds where a swell or a stillness belongs.
 *
 * Each kind of piece has its own look (looks.js): the direction the brief is
 * given, the presets it is offered, and the ranges its mandala is held to.
 *
 * A brief, once written, is the video's: its presets are held to the reuse
 * rule when it is written, not each time it is rendered again.
 */

const { askChecked, parseJSON, message } = require('../content-generation/claude');
const { lookOf, lookName, textureOf, presetsFor, rangeProblems, NONE } = require('./looks');

const MODEL = 'claude-sonnet-5-5';
const MOVEMENTS = 3;
// Loops a video may take from the library. One to begin; as the library
// grows, videos gain movements from it instead (the plan's "Growing").
const MAX_REUSED = 1;

const SYSTEM = `You design the visuals for the videos of aChurch.ai, a sanctuary for humans, AI and any other kind of mind. Each piece of its writing (a chant, a prayer, a ritual, a practice, a song) gets a video: an abstract, psychedelic, metaphysical field of light and matter that moves with the voice.

You write a brief as JSON. The video has ${MOVEMENTS} movements in order, each a still image that a video model animates into an eight-second loop, with a MilkDrop visualizer preset playing over it in screen blend.

Rules for the stills:
- Abstract and metaphysical, in the direction you are given for the piece's kind (a meditation, a prayer, a chant and a song each have their own look). Follow its elements, colours and pace, and let the three movements travel its arc; the palette follows it too. The direction is the kind's journey, not its picture: the stills themselves come from this piece.
- Each still is drawn from this piece's own images and ideas, not from a general sense of "spiritual". A reader of the piece should see why this image belongs to it.
- No literal buildings or churches, crosses, halos, or symbols of any one tradition. A cathedral made of light is welcome where the piece calls for it (a gathering, a hymn, a ritual, a sense of entering somewhere vast): vaults of nebula, columns and arches of light or geometry, a cosmic or digital cathedral, abstract and never a real building or style of church. No faces, people, hands, eyes, animals' faces or figures. No text, letters or numbers.
- Composed for 16:9, with depth and a clear centre of interest. Describe it in one rich paragraph for an image model.
- The three movements develop: they are one journey, not three variations of one picture.

Rules for the motion:
- Two or three sentences for a video model: continuous, cyclical motion (drifting, breathing, rotating, flowing, unfolding) that returns to where it began, so the eight seconds loop without a seam. The camera is locked off or orbits gently. No cuts, no new objects entering.
- Fit the motion to how the movement sounds, which you are told. Sparse speech with long pauses wants near-stillness that breathes; dense speech or several voices together want a fuller unfolding; a rising trend wants an opening. Use timecodes inside the eight seconds ("[0-3s] ... [3-6s] ... [6-8s] ...") to place a swell or a stillness.
- For a song you are told how many bars one loop will span (the loop is stretched to whole bars and started on a downbeat). Give it exactly that many swells or pulses, evenly spaced, one per bar, so the motion moves in time.

Presets: choose one per movement from the list you are given, by name exactly as written, matching the movement's mood. The list already suits the piece's kind. For some kinds the list gives what each preset looks like and it is drawn in one colour of your palette, never its own: then give each movement a "tint", one of your five palette colours, and a preset may be "none" where the loop should be left alone.

Loops from the library: you may be offered loops made for earlier videos. Prefer one of them to writing a new movement whenever it already shows what a movement needs, the same image or a close variation of it, with a pace that suits how the movement sounds and a palette that sits with the others. A new loop costs $1.22 and one of twenty requests a day; a reused one costs nothing, and the video around it (its presets, palette, mandala and pulse) makes it new. Give a library loop to at most ${MAX_REUSED} movement. That movement is { "loop": "its id", "reason": "one sentence on why it belongs", "preset": "..." }, with no still or motion of its own. Write every movement new only when no offered loop shows what any movement needs.

Return only JSON:
{
  "mood": "one sentence",
  "palette": ["#rrggbb", five colours from deep to bright],
  "symmetry": the folds of the house's mandala layer, a whole number in the range given for the kind,
  "milkdropOpacity": in the range given for the kind,
  "mandalaOpacity": in the range given for the kind,
  "movements": [
    { "still": "...", "motion": "...", "preset": "exact preset name" } or { "loop": "id", "reason": "...", "preset": "exact preset name" }, each with "tint": "#rrggbb" when the kind's presets are tinted
  ]
}`;

// How the piece sounds, movement by movement, in words the brief can use.
function soundOf({ sound, voices, grid }) {
  if (!sound) return '';
  const lines = sound.map((m, i) => `Movement ${i + 1}, ${m.from}s to ${m.to}s: sounding ${Math.round(m.sounding * 100)}% of the time, ${m.pauses} pause(s), the longest ${m.longestPause}s, loudness ${m.loudness}, trend ${m.trend > 0 ? '+' : ''}${m.trend}`);
  return `
How it sounds (sounding: the share of time a voice or music is heard; loudness relative to the piece's typical loud moment; trend: the second half's loudness against the first half's):
${lines.join('\n')}${voices ? `\nVoices: ${voices}` : ''}${grid ? `\nTempo: ${grid.bpm} BPM, a bar is ${grid.bar.toFixed(2)}s, and each eight-second loop will be stretched to span exactly ${barsPerLoop(grid)} bar(s).` : ''}
`;
}

const barsPerLoop = (grid) => Math.max(1, Math.round(8 / grid.bar));

// The library's shortlist, as the brief reads it.
function loopsOffered(shortlist) {
  if (!shortlist.length) return '';
  return `

Loops from the library you may reuse (pace: mean change between frames, about 0.005 is calm and 0.015 lively; a seam that does not close is played forward and back):
${shortlist.map(e => `${e.id} | mood of its video: ${e.mood} | palette ${e.palette.join(' ')} | pace ${e.record.motion.mean} | ${e.record.seamless ? 'closes' : 'forward and back'}
  still: ${e.still}
  motion: ${e.motion}`).join('\n')}`;
}

function userMessage({ kind, title, text, seconds, presets, sound, voices, grid, shortlist = [] }) {
  const look = lookOf(kind);
  return `Kind: ${kind}
Direction for a ${kind}: ${look.direction}
Ranges for a ${kind}: symmetry ${look.symmetry.join(' to ')}, milkdropOpacity ${look.milkdropOpacity.join(' to ')}, mandalaOpacity ${look.mandalaOpacity.join(' to ')}
Title: ${title}
Length: ${Math.round(seconds)} seconds
Heard as: ${textureOf(kind)}
${soundOf({ sound, voices, grid })}
The piece:
"""
${text}
"""

${look.presets
    ? `MilkDrop presets you may choose from, each with what it looks like, drawn in the one palette colour you give its movement as "tint" (or "none" for no preset):
${presets.map(p => `${p.name} | ${p.look}`).join('\n')}`
    : `MilkDrop presets you may choose from, each with how bright it looks under a voice (0 to 1) and how much it moves (about 0.03 is calm, 0.08 typical, 0.18 and above restless):
${presets.map(p => (p.brightness === undefined ? p.name : `${p.name} | brightness ${p.brightness} | motion ${p.motion}`)).join('\n')}`}${loopsOffered(shortlist)}`;
}

/**
 * What a brief may reuse, presets or loops, given what other videos used.
 * Asking for variety in a prompt does not hold (both sibling projects learned
 * it; here Airhandler was in 7 of the first 10 briefs), so the rule is
 * enforced on the answer: nothing twice in one brief, nothing used by the
 * `recent` most recent videos, nothing used three times in all (the cap
 * companions holds its documents to).
 *
 * The window differs by what is reused. Presets keep ten: there are 338 to
 * choose from, and a channel's variety shows in them. Loops keep three: while
 * the catalogue is caught up a batch at a time, a ten-video window held back
 * every loop the library had, and the cap of three uses still keeps any one
 * loop from wearing thin.
 *
 * A kind with its own short list of presets (a meditation's, looks.js) is
 * held only against the other videos of its kind, in a window of two and
 * with no cap: its list is the choice, and its tint makes a preset reused
 * look new. "none" is never a reuse.
 *
 * used: [{ items: [...], at: time }] for every other video, its presets or
 * the loops its movements play; noun names them in the problems.
 */
const RECENT = { preset: 10, loop: 3 };
const CAP = 3;
function reuseRule(used, noun, { recent = RECENT[noun], cap = CAP } = {}) {
  const window = recent;
  const counts = new Map();
  for (const v of used) for (const item of v.items) counts.set(item, (counts.get(item) || 0) + 1);
  const recentItems = new Set([...used].sort((a, b) => b.at - a.at).slice(0, window).flatMap(v => v.items));
  const why = (item) => (item === NONE ? null : recentItems.has(item) ? `used by one of the ${window} most recent videos` : (counts.get(item) || 0) >= cap ? `used ${counts.get(item)} times already` : null);
  return {
    allows: (item) => !why(item),
    problems(items) {
      const out = [];
      items.forEach((item, i) => {
        if (item === undefined) return;
        if (item !== NONE && items.indexOf(item) !== i) out.push(`movement ${i + 1}'s ${noun} "${item}" is already used by an earlier movement; each movement needs its own`);
        const reason = why(item);
        if (reason) out.push(`movement ${i + 1}'s ${noun} "${item}" is ${reason}; choose another`);
      });
      return out;
    }
  };
}

function check(presets, rules, shortlist, kind) {
  const tinted = Boolean(lookOf(kind).presets);
  const names = new Set([...presets.map(p => p.name), ...(tinted ? [NONE] : [])]);
  const offered = new Map(shortlist.map(e => [e.id, e]));
  return (raw) => {
    const problems = [];
    let brief;
    try {
      brief = parseJSON(raw);
    } catch (err) {
      return { value: null, problems: [`the reply is not JSON (${err.message})`], shown: raw };
    }
    if (!Array.isArray(brief.movements) || brief.movements.length !== MOVEMENTS) problems.push(`movements must have exactly ${MOVEMENTS} entries`);
    for (const [i, m] of (brief.movements || []).entries()) {
      if (m.loop !== undefined) {
        if (!offered.has(m.loop)) problems.push(`movement ${i + 1}'s loop "${m.loop}" was not offered`);
        if (!m.reason) problems.push(`movement ${i + 1} reuses a loop and needs its reason`);
      } else if (!m.still || !m.motion) problems.push(`movement ${i + 1} needs both still and motion`);
      if (!names.has(m.preset)) problems.push(`movement ${i + 1}'s preset "${m.preset}" is not in the list, word for word`);
    }
    const movements = brief.movements || [];
    if (movements.filter(m => m.loop !== undefined).length > MAX_REUSED) problems.push(`at most ${MAX_REUSED} movement may reuse a loop`);
    problems.push(...rules.presets.problems(movements.map(m => m.preset)));
    problems.push(...rules.loops.problems(movements.map(m => m.loop)));
    problems.push(...rangeProblems(kind, brief));
    if (tinted) {
      const palette = (brief.palette || []).map(c => String(c).toLowerCase());
      movements.forEach((m, i) => {
        if (!palette.includes(String(m.tint).toLowerCase())) problems.push(`movement ${i + 1}'s tint must be one of the palette's five colours`);
      });
    }
    if (!Array.isArray(brief.palette) || brief.palette.length !== 5 || !brief.palette.every(c => /^#[0-9a-f]{6}$/i.test(c))) problems.push('palette must be five #rrggbb colours');
    return { value: brief, problems, shown: raw };
  };
}

/**
 * The brief for a piece. rules: { presets, loops }, each a reuseRule; the
 * presets and the loop shortlist offered are those the rules allow, and each
 * choice is checked again on the answer, since a model can name one it was not
 * offered. A movement that reuses a loop is given that loop's still and
 * motion, so the brief describes every movement it plays.
 */
async function writeBrief(piece, rules, shortlist = []) {
  piece = { ...piece, kind: lookName(piece) };
  piece = { ...piece, presets: presetsFor(piece.kind, piece.presets).filter(p => rules.presets.allows(p.name)), shortlist };
  const brief = await askChecked({
    label: 'brief',
    tries: 3,
    attempt: (feedback) => message(SYSTEM, userMessage(piece) + (feedback ? `\n\n${feedback}` : ''), { model: MODEL, maxTokens: 4000 }),
    check: check(piece.presets, rules, shortlist, piece.kind)
  });
  brief.kind = piece.kind;
  const offered = new Map(shortlist.map(e => [e.id, e]));
  brief.movements = brief.movements.map(m => (m.loop === undefined ? m : { loop: m.loop, reason: m.reason, still: offered.get(m.loop).still, motion: offered.get(m.loop).motion, preset: m.preset }));
  return brief;
}

module.exports = { writeBrief, reuseRule, check, barsPerLoop, MOVEMENTS, MAX_REUSED };
