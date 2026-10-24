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
const { sectionsOf } = require('../song-generation/song-file');

// A section of the plan: ElevenLabs takes 3 to 120 seconds.
const CHUNK_MIN = 3;
const CHUNK_MAX = 120;
// The first chunk carries the whole style line, later ones its first few:
// ElevenLabs asks for six or seven styles at least on the opening chunk.
const LATER_STYLES = 5;

// The style line as styles: its comma-separated phrases, each short.
const stylesOf = style => style.split(/[,;.]\s+|\n/).map(s => s.trim().replace(/\.$/, '')).filter(s => s && s.length <= 80);

// "Verse 2 - lower voice solo, the human voice" as its name and its directions.
function sectionParts(name) {
  const [label, directions = ''] = String(name).split(/\s+-\s+/, 2);
  return { label: label.trim(), directions: directions.split(',').map(s => s.trim()).filter(Boolean) };
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
  const first = sectionParts(sections[0].name).label;
  const last = sectionParts(sections[sections.length - 1].name).label;
  if (!/^intro/i.test(first)) chunks.push(chunk('Intro', [], [...lane, ...music.shared, 'instrumental', 'enters softly from near silence'], music.leadIn));
  for (const section of sections) {
    const { label, directions } = sectionParts(section.name);
    const styles = [...(chunks.length ? lane.slice(0, LATER_STYLES) : lane), ...music.shared, ...directions];
    const seconds = section.lines.length ? section.lines.length * lineSeconds + 2 : (/^outro/i.test(label) ? music.tail : music.leadIn);
    chunks.push(chunk(label, section.lines, styles, seconds));
  }
  if (!/^outro/i.test(last)) chunks.push(chunk('Outro', [], [...lane.slice(0, LATER_STYLES), ...music.shared, 'instrumental', 'held final chord', 'long gentle tail into silence'], music.tail));
  return { chunks };
}

module.exports = { planFor, sectionParts, stylesOf, CHUNK_MIN, CHUNK_MAX };
