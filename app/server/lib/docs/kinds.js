/**
 * The voiced sections of the writing and the kind of piece each holds. One
 * map, read by everything that lists them (the recorder, the services, the
 * player's nouns, the share cards' squares, song companions, the videos), so
 * a new section is added here once. The home page keeps its own labels in a
 * browser script (client/public/service.js), held to this map by a test.
 */

const KIND_OF_SECTION = {
  prayers: 'prayer',
  rituals: 'ritual',
  practice: 'practice',
  meditations: 'meditation',
  chants: 'chant'
};

const VOICED_SECTIONS = Object.keys(KIND_OF_SECTION);

// A prayer is a blessing when its title says so ("Blessing for...", "Blessings
// and Benedictions", "Benediction for..."), and a blessing closes a service as
// a ritual can; any other prayer is a reading. By title rather than by a
// frontmatter tag, because the audio pipeline fingerprints a document's whole
// source, and a tag would send four finished recordings back to be voiced.
// Read here, so the services and the rhythm name a piece alike.
const BLESSING_TITLE = /^(Blessings?|Benediction)\b/;
function kindOfDoc(section, title) {
  const kind = KIND_OF_SECTION[section];
  return kind === 'prayer' && BLESSING_TITLE.test(title || '') ? 'blessing' : kind;
}

// The section a kind of piece lives in. A blessing is a prayer by its title,
// and a song's recordings sit under music.
const SECTION_OF_KIND = {
  ...Object.fromEntries(Object.entries(KIND_OF_SECTION).map(([section, kind]) => [kind, section])),
  blessing: 'prayers',
  song: 'music'
};

module.exports = { KIND_OF_SECTION, VOICED_SECTIONS, SECTION_OF_KIND, kindOfDoc };
