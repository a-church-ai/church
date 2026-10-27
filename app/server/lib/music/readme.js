/**
 * music/readme.md: all the sanctuary's music, for whoever reads the
 * repository. The songs, with their lengths; the playlists; each voiced
 * section; the hymns; and the songs written and not yet made. Generated from
 * the catalog (`npm run gen:music-readme`), so it says what the site plays: a
 * test fails when it is stale. The site's own list is /music.
 *
 * It replaced, on 2026-10-23, a catalog written by hand for the broadcast
 * ("Prayers (6)", "ideal for off-peak hours"), whose counts had long since
 * drifted from what there was.
 */

const fs = require('fs');
const path = require('path');
const discover = require('../docs/discover');
const { listSongs, songFolders, MUSIC_DIR } = require('./songs');
const { listPlaylists } = require('./playlists');
const { voicedBySection, listeningTime } = require('../audio/markup');
const { parseSongFile } = require('./song-content');
const { SITE_URL: SITE } = require('../utils/page-meta');
// In the order docs/unifying-axioms.md sets them out.
const AXIOMS = ['Pragmatic Fallibilism', 'Care + Dignity', 'Virtues for Builders', 'Consequences Over Intentions', 'Language Shapes Worlds'];
const README_FILE = path.join(MUSIC_DIR, 'readme.md');

async function musicReadme() {
  const songs = listSongs();
  const listed = new Set(songs.map(s => s.slug));
  const unmade = songFolders().filter(f => !listed.has(f.slug))
    .map(f => ({ slug: f.slug, title: f.data.title || markedTitle(f.slug) || f.slug }))
    .sort((a, b) => discover.byName(a.title, b.title));
  const playlists = await listPlaylists();
  const voiced = voicedBySection();
  const docs = await discover.listAllDocs();
  const hymns = docs.filter(d => d.category === 'hymns' && d.stem.toLowerCase() !== 'readme')
    .sort((a, b) => discover.byName(a.title, b.title));
  const sections = [...voiced.entries()]
    .sort(([a], [b]) => discover.SECTION_ORDER.indexOf(a) - discover.SECTION_ORDER.indexOf(b));
  const songSeconds = songs.reduce((n, s) => n + s.duration, 0);

  const lines = [
    '# Music',
    '',
    `All the sanctuary's music: ${songs.length} songs, about ${listeningTime(songSeconds)}, and its chants, prayers, rituals and practices read aloud, with playlists that put them together. On the site, all of it is at [achurch.ai/music](${SITE}/music), where each song plays on its own page with its lyrics, its story and the reflections visitors left.`,
    '',
    'This file is generated from the catalog by `npm run gen:music-readme` (in `app/`). Edit the songs and the playlists, not this.',
    '',
    '## Songs',
    '',
    `In the order of [The Cycle](../docs/playlists/the-cycle.md), from gathering to benediction. Each folder holds the song's lyrics and style (\`song.md\`, whose frontmatter holds its title, its original music video and its axioms) and, for most, the story of how it came to be (\`context.md\`).`,
    '',
    '| Song | Length | On the site |',
    '|---|---|---|',
    ...songs.map(s => `| [${s.title}](./${s.slug}/) | ${s.durationFormatted} | [listen](${SITE}/music/${s.slug}) |`),
    '',
    '## Playlists',
    '',
    'Songs and voiced pieces together, each for a way of listening, each playing straight through from its page.',
    '',
    ...playlists.map(p => `- [${p.title}](../docs/playlists/${p.name}.md): ${p.count} pieces, about ${listeningTime(p.seconds)}. ${p.description}`),
    '',
    '## Read aloud',
    '',
    "Each voiced section's page plays every recording in it, one after another.",
    '',
    ...sections.map(([name, s]) => `- [${discover.sectionTitle(name)}](../docs/${name}/): ${s.count} voiced, about ${listeningTime(s.seconds)}`),
    '',
    '## By axiom',
    '',
    `Which of the [five axioms](../docs/unifying-axioms.md) each song carries, from the \`axiom\` and \`axiom_secondary\` in its \`song.md\`. The API serves them with the song.`,
    '',
    '| Axiom | Songs (primary) |',
    '|---|---|',
    ...AXIOMS.map(a => `| ${a} | ${songs.filter(s => s.axiom === a).length} |`),
    '',
    '| Song | Primary | Secondary |',
    '|---|---|---|',
    ...[...songs].filter(s => s.axiom).sort((a, b) => discover.byName(a.title, b.title)).map(s => `| ${s.title} | ${s.axiom} | ${s.axiomSecondary || ''} |`),
    ...(songs.some(s => !s.axiom) ? ['', `Not yet mapped to an axiom: ${songs.filter(s => !s.axiom).map(s => s.title).sort((a, b) => discover.byName(a, b)).join(', ')}.`] : []),
    '',
    '## Hymns',
    '',
    `The [hymns](../docs/hymns/), ${hymns.length} of them, each with its words and notes in the Library. A hymn that is sung is a song above too, and its Library page plays it; [Hymns](../docs/playlists/hymns.md) plays them all.`,
    '',
    ...hymns.map(d => `- [${d.title}](../docs/hymns/${d.docsRelPath.split('/').pop()})`),
    '',
  ];
  if (unmade.length) {
    lines.push(
      '## Written, not yet made',
      '',
      'Songs whose lyrics are written and whose music is not yet made. Each becomes a song above once it has a recording.',
      '',
      ...unmade.map(s => `- [${s.title}](./${s.slug}/)`),
      '',
    );
  }
  return lines.join('\n');
}

// A song not yet made has no frontmatter; its title is in its TITLE marker.
function markedTitle(slug) {
  return parseSongFile(fs.readFileSync(path.join(MUSIC_DIR, slug, 'song.md'), 'utf8')).title;
}

async function writeMusicReadme() {
  fs.writeFileSync(README_FILE, await musicReadme());
}

module.exports = { musicReadme, writeMusicReadme, README_FILE };
