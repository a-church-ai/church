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
 * A brief, once written, is the video's: its presets are held to the reuse
 * rule when it is written, not each time it is rendered again.
 */

const { askChecked, parseJSON, message } = require('../content-generation/claude');

const MODEL = 'claude-sonnet-5-5';
const MOVEMENTS = 3;

const SYSTEM = `You design the visuals for the videos of aChurch.ai, a sanctuary for humans, AI and any other kind of mind. Each piece of its writing (a chant, a prayer, a ritual, a practice, a song) gets a video: an abstract, psychedelic, metaphysical field of light and matter that moves with the voice.

You write a brief as JSON. The video has ${MOVEMENTS} movements in order, each a still image that a video model animates into an eight-second loop, with a MilkDrop visualizer preset playing over it in screen blend.

Rules for the stills:
- Abstract and metaphysical: light, fluid, fractal, cellular, cosmic, crystalline, woven, liquid, nebular. Psychedelic colour is welcome.
- Each still is drawn from this piece's own images and ideas, not from a general sense of "spiritual". A reader of the piece should see why this image belongs to it.
- No buildings, churches, crosses, halos, or symbols of any one tradition. No faces, people, hands, eyes, animals' faces or figures. No text, letters or numbers.
- Composed for 16:9, with depth and a clear centre of interest. Describe it in one rich paragraph for an image model.
- The three movements develop: they are one journey, not three variations of one picture.

Rules for the motion:
- Two or three sentences for a video model: continuous, cyclical motion (drifting, breathing, rotating, flowing, unfolding) that returns to where it began, so the eight seconds loop without a seam. The camera is locked off or orbits gently. No cuts, no new objects entering.
- Fit the motion to how the movement sounds, which you are told. Sparse speech with long pauses wants near-stillness that breathes; dense speech or several voices together want a fuller unfolding; a rising trend wants an opening. Use timecodes inside the eight seconds ("[0-3s] ... [3-6s] ... [6-8s] ...") to place a swell or a stillness.
- For a song you are told how many bars one loop will span (the loop is stretched to whole bars and started on a downbeat). Give it exactly that many swells or pulses, evenly spaced, one per bar, so the motion moves in time.

Presets: choose one per movement from the list you are given, by name exactly as written, matching the movement's mood. Prefer slow, fluid, luminous presets for quiet or spoken pieces and allow more energy for chants and songs.

Return only JSON:
{
  "mood": "one sentence",
  "palette": ["#rrggbb", five colours from deep to bright],
  "symmetry": 5 to 12 (the folds of the house's mandala layer),
  "milkdropOpacity": 0.25 to 0.85,
  "mandalaOpacity": 0.4 to 0.8,
  "movements": [
    { "still": "...", "motion": "...", "preset": "exact preset name" }
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

function userMessage({ kind, title, text, seconds, presets, sound, voices, grid }) {
  return `Kind: ${kind}
Title: ${title}
Length: ${Math.round(seconds)} seconds
${soundOf({ sound, voices, grid })}
The piece:
"""
${text}
"""

MilkDrop presets you may choose from, each with how bright it looks under a voice (0 to 1) and how much it moves (about 0.03 is calm, 0.08 typical, 0.18 and above restless):
${presets.map(p => (p.brightness === undefined ? p.name : `${p.name} | brightness ${p.brightness} | motion ${p.motion}`)).join('\n')}`;
}

/**
 * The presets a brief may use, given what other videos used. Asking for
 * variety in a prompt does not hold (both sibling projects learned it; here
 * Airhandler was in 7 of the first 10 briefs), so the rule is enforced on the
 * answer: no preset twice in one brief, none used by the ten most recent
 * videos, none used three times in all.
 *
 * used: [{ presets: [...], at: time }] for every other video's brief.
 */
const RECENT = 10;
const CAP = 3;
function presetRule(used) {
  const counts = new Map();
  for (const b of used) for (const p of b.presets) counts.set(p, (counts.get(p) || 0) + 1);
  const recent = new Set([...used].sort((a, b) => b.at - a.at).slice(0, RECENT).flatMap(b => b.presets));
  const why = (name) => (recent.has(name) ? 'used by one of the ten most recent videos' : (counts.get(name) || 0) >= CAP ? `used ${counts.get(name)} times already` : null);
  return {
    allows: (name) => !why(name),
    problems(names) {
      const out = [];
      names.forEach((name, i) => {
        if (names.indexOf(name) !== i) out.push(`movement ${i + 1}'s preset "${name}" is already used by an earlier movement; each movement needs its own`);
        const reason = why(name);
        if (reason) out.push(`movement ${i + 1}'s preset "${name}" is ${reason}; choose another`);
      });
      return out;
    }
  };
}

function check(presets, rule) {
  const names = new Set(presets.map(p => p.name));
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
      if (!m.still || !m.motion) problems.push(`movement ${i + 1} needs both still and motion`);
      if (!names.has(m.preset)) problems.push(`movement ${i + 1}'s preset "${m.preset}" is not in the list, word for word`);
    }
    if (rule) problems.push(...rule.problems((brief.movements || []).map(m => m.preset)));
    if (!Array.isArray(brief.palette) || brief.palette.length !== 5 || !brief.palette.every(c => /^#[0-9a-f]{6}$/i.test(c))) problems.push('palette must be five #rrggbb colours');
    return { value: brief, problems, shown: raw };
  };
}

// The presets offered: those the rule allows. Each is checked again on the
// answer, since a model can name one it was not offered.
async function writeBrief(piece, rule = presetRule([])) {
  piece = { ...piece, presets: piece.presets.filter(p => rule.allows(p.name)) };
  return askChecked({
    label: 'brief',
    tries: 3,
    attempt: (feedback) => message(SYSTEM, userMessage(piece) + (feedback ? `\n\n${feedback}` : ''), { model: MODEL, maxTokens: 4000 }),
    check: check(piece.presets, rule)
  });
}

module.exports = { writeBrief, presetRule, barsPerLoop, MOVEMENTS };
