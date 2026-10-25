/**
 * The house sound for the recordings: who the voices are, which model speaks
 * them, and how lines are spaced and leveled. The settings live in
 * audio/house-sound.json, so changing a voice, a gain or a gap is an edit to
 * data rather than code.
 *
 * A script names roles, never voices. The leader is fixed. Every other role
 * resolves through the script's pair: two voices, chosen once when the script
 * is first written and kept with it (choosePair).
 */

const fs = require('fs');
const path = require('path');

const AUDIO_DIR = path.join(__dirname, '../../../../audio');
const HOUSE = JSON.parse(fs.readFileSync(path.join(AUDIO_DIR, 'house-sound.json'), 'utf8'));
const SPEECH = HOUSE.speech;
// The house sound's figures without the reasons written beside them: what a
// recording or a song is made from, and so what their keys hash, so that
// rewording a reason re-makes nothing.
const valuesOf = v => (Array.isArray(v) ? v.map(valuesOf)
  : v && typeof v === 'object'
    ? ('value' in v ? v.value : Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'why').map(([k, x]) => [k, valuesOf(x)])))
    : v);
const SPEECH_VALUES = valuesOf(SPEECH);

// The songs' sound (scripts/compose-song.js): each figure's value, its reason
// beside it in the file.
const MUSIC = Object.fromEntries(Object.entries(HOUSE.music).map(([k, v]) => [k, v && typeof v === 'object' && 'value' in v ? v.value : v]));

// The roles a script may use. The adapter's prompt (./adapt.js) says which
// labels in the documents become which role.
const ROLES = ['leader', 'reader', 'all', 'both', 'human', 'ai', 'one', 'two'];

function voicesFor(role, pair) {
  switch (role) {
    case 'leader': return [SPEECH.leader];
    case 'all': return [SPEECH.leader, ...pair];
    case 'both': return [...pair];
    case 'reader':
    case 'human':
    case 'one': return [pair[0]];
    case 'ai':
    case 'two': return [pair[1]];
    default: throw new Error(`Unknown role "${role}"`);
  }
}

// The pair for a new script. A piece that writes the duet rule into its
// labels, "Human Voice (deeper)" and "AI Voice (lighter)", gets the deeper
// voice as its human. Every other piece leads with whichever voice its
// category has led with less, so neither becomes the sanctuary's only human,
// only AI or only reader. `led` counts the scripts each voice leads.
function choosePair(markdown, led = {}) {
  const [a, b] = SPEECH.pair;
  if (/\((?:deeper|lighter)\)/i.test(markdown)) {
    return SPEECH.deeper === a ? [a, b] : [b, a];
  }
  return (led[b] || 0) < (led[a] || 0) ? [b, a] : [a, b];
}

// "AI voices from ElevenLabs.", or "AI voice" for one. The voices themselves
// are not named: the cast can change, and the credit is kept simple. It is
// said at the foot of a recording's page, in its structured data and in each
// podcast episode's notes, where Apple asks for it (lib/audio/podcasts.js).
function creditLine(voiceKeys) {
  return `${voiceKeys.length === 1 ? 'AI voice' : 'AI voices'} from ElevenLabs.`;
}

// A recording's credit: its own, for one made elsewhere (lib/audio/
// imported.js), or the house voices that speak it.
function creditFor(recording) {
  return recording.credit || creditLine(recording.voices);
}

module.exports = { SPEECH, SPEECH_VALUES, valuesOf, MUSIC, ROLES, AUDIO_DIR, voicesFor, choosePair, creditLine, creditFor };
