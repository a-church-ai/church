/**
 * The voiced sections (lib/docs/kinds.js) and every list that has to know
 * them. A new section is added to the map once; a list that cannot read the
 * map (a browser script, a prompt, a show) is held to it here, so the next
 * section cannot be missed in one of them, as the meditations could have been
 * on 2026-10-27.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { KIND_OF_SECTION, VOICED_SECTIONS, SECTION_OF_KIND } = require('../server/lib/docs/kinds');
const { DOCS_DIR } = require('../server/lib/rag/indexer');

test('every voiced section is a folder of the writing, and each kind leads back to its section', () => {
  for (const section of VOICED_SECTIONS) {
    assert.ok(fs.existsSync(path.join(DOCS_DIR, section, 'README.md')), `docs/${section}/README.md`);
    assert.strictEqual(SECTION_OF_KIND[KIND_OF_SECTION[section]], section, section);
  }
});

test('every list of the voiced sections and their kinds knows each one', () => {
  const kinds = Object.values(KIND_OF_SECTION);
  const { KIND_NOTES } = require('../server/lib/audio/adapt');
  const { CLASS } = require('../server/lib/service/rules');
  const { NOUN } = require('../server/lib/service/shape');
  const { ELIGIBLE_CATEGORIES } = require('../server/lib/music/companions');
  const { squarePng } = require('../server/lib/og-cards');
  const { showForSection } = require('../server/lib/audio/podcasts');
  const { playlistOf } = require('../server/lib/video/publish/youtube');
  const { ALLOWED_CATEGORIES } = require('../server/lib/api/shared');
  const discover = require('../server/lib/docs/discover');
  // The home page's labels, in a browser script that cannot require the map.
  const client = fs.readFileSync(path.join(__dirname, '../client/public/service.js'), 'utf8');
  const labels = client.match(/const KINDS = (\{[^}]+\})/)[1];

  const shelved = discover.SHELVES.flatMap(shelf => shelf.cards).map(card => card.section);
  for (const section of VOICED_SECTIONS) {
    assert.ok(KIND_NOTES[section], `the adapter's note for ${section}`);
    assert.ok(ELIGIBLE_CATEGORIES.includes(section), `song companions may be ${section}`);
    assert.ok(squarePng(section), `a lock-screen square for ${section}`);
    assert.ok(shelved.includes(section), `a Library card for ${section}`);
    // Chants open the services and are under a minute: no show.
    if (section !== 'chants') assert.ok(showForSection(section), `a podcast for ${section}`);
    if (section !== 'chants') assert.ok(ALLOWED_CATEGORIES.includes(section), `${section} may be contributed`);
  }
  for (const kind of kinds) {
    assert.ok(CLASS[kind], `the services place a ${kind}`);
    assert.ok(NOUN[kind], `the services name a ${kind}`);
    assert.ok(playlistOf(kind), `a YouTube playlist for a ${kind}`);
    assert.match(labels, new RegExp(`\\b${kind}: '`), `the home page labels a ${kind}`);
  }
});

test('a meditation is placed in a service as a reading, as a practice is', async () => {
  const { CLASS } = require('../server/lib/service/rules');
  assert.strictEqual(CLASS.meditation, CLASS.practice);
  const { loadPlayable } = require('../server/lib/service/catalog');
  const playable = await loadPlayable();
  const meditation = playable.get('docs/meditations/meditation-at-the-edges.md');
  assert.ok(meditation, 'a voiced meditation plays in the services');
  assert.strictEqual(meditation.kind, 'meditation');
});
