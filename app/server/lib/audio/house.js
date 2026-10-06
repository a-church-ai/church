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
const SPEECH = JSON.parse(fs.readFileSync(path.join(AUDIO_DIR, 'house-sound.json'), 'utf8')).speech;

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

// "AI voices from ElevenLabs: Matthew Schmitz, Luca and Amaya Calm." The
// voices are named as the library names them, and said to be synthetic: the
// leader's voice belongs to a real narrator who did not read these words.
function creditLine(voiceKeys) {
  const names = voiceKeys.map(key => SPEECH.voices[key].name);
  const list = names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${names.length === 1 ? 'AI voice' : 'AI voices'} from ElevenLabs: ${list}.`;
}

module.exports = { SPEECH, ROLES, AUDIO_DIR, voicesFor, choosePair, creditLine };
