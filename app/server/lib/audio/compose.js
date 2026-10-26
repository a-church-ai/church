/**
 * A song's composition plan for ElevenLabs Music, from its own song.md: a
 * chunk a section of its lyrics (lib/song-generation/song-file.js sectionsOf),
 * each with the song's lane (its style line), the house's shared sound and
 * the section's own directions ("[Verse 2 - lower voice solo, the human
 * voice]"), timed from its lines and the song's tempo; and a soft lead-in and
 * a tail, unless the song has its own, so it sits between spoken pieces.
 * scripts/compose-song.js sends it. The figures are the house's
 * (audio/house-sound.json `music`).
 */

const { MUSIC } = require('./house');
const { sectionsOf, stylePhrases } = require('../song-generation/song-file');

// A section of the plan: ElevenLabs takes 3 to 120 seconds.
const CHUNK_MIN = 3;
const CHUNK_MAX = 120;
// The first chunk carries the whole style line, later ones its first few:
// ElevenLabs asks for six or seven styles at least on the opening chunk.
const LATER_STYLES = 5;

// The style line as styles: its comma-separated phrases. None is dropped:
// validateSong refuses a phrase too long to send, by name.
const stylesOf = stylePhrases;

// "Verse 2 - lower voice solo, the human voice" as its name and its
// directions; a direction "30 seconds" sets the section's length (a silence
// the song asks for, an interlude).
function sectionParts(name) {
  const [label, directions = ''] = String(name).split(/\s+-\s+/, 2);
  const parts = directions.split(',').map(s => s.trim()).filter(Boolean);
  const timed = parts.map(p => /^(\d+)\s*seconds?$/i.exec(p)).find(Boolean);
  return { label: label.trim(), directions: parts.filter(p => !/^\d+\s*seconds?$/i.test(p)), ...(timed ? { seconds: Number(timed[1]) } : {}) };
}

function planFor(song, music = MUSIC) {
  const bpm = Number((/(\d+)\s*BPM/i.exec(song.style) || [])[1]) || music.fallbackBpm;
  const lineSeconds = (music.beatsPerLine * 60) / bpm;
  const lane = stylesOf(song.style);
  const sections = sectionsOf(song.lyrics);
  const chunk = (label, lines, styles, seconds) => ({
    text: `[${label}]${lines.length ? `\n${lines.join('\n')}` : ''}`,
    duration_ms: Math.round(Math.min(CHUNK_MAX, Math.max(CHUNK_MIN, seconds)) * 1000),
    positive_styles: styles,
    negative_styles: music.avoid,
    context_adherence: 'high',
  });
  const chunks = [];
  // The song's own instrumental intro and outro stand in for the lead-in and
  // the tail; one that is sung does not, since the song would begin or end on
  // a voice.
  const first = sections[0];
  const last = sections[sections.length - 1];
  if (!(/^intro/i.test(sectionParts(first.name).label) && !first.lines.length)) chunks.push(chunk('Intro', [], [...lane, ...music.shared, 'instrumental', 'enters softly from near silence'], music.leadIn));
  for (const section of sections) {
    const { label, directions, seconds: marked } = sectionParts(section.name);
    const styles = [...(chunks.length ? lane.slice(0, LATER_STYLES) : lane), ...music.shared, ...directions];
    const seconds = marked || (section.lines.length ? section.lines.length * lineSeconds + 2 : (/^outro/i.test(label) ? music.tail : music.leadIn));
    chunks.push(chunk(label, section.lines, styles, seconds));
  }
  if (!(/^outro/i.test(sectionParts(last.name).label) && !last.lines.length)) chunks.push(chunk('Outro', [], [...lane.slice(0, LATER_STYLES), ...music.shared, 'instrumental', 'held final chord', 'long gentle tail into silence'], music.tail));
  return { chunks };
}

module.exports = { planFor, sectionParts, stylesOf, CHUNK_MIN, CHUNK_MAX };
