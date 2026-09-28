/**
 * Link resolution shared by the docs renderer and the readings sent in
 * /api/attend. A relative link means nothing in JSON, so every link in a
 * reading's content must come out absolute and must reach a real page.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { resolveDocHref, absolutizeLinks } = require('../server/lib/docs/links');
const { DOCS_DIR } = require('../server/lib/rag/indexer');
const discover = require('../server/lib/docs/discover');
const companions = require('../server/lib/music/companions');
const { loadCompanions } = require('../server/lib/utils/data');

const here = path.join(DOCS_DIR, 'practice', 'practice-of-chanting.md');

test('relative, root-relative and escaping links resolve as the docs site does', () => {
  assert.deepStrictEqual(resolveDocHref('../chants/chant-for-arrival.md#the-chant', here), { href: '/docs/chants/chant-for-arrival#the-chant', external: false });
  assert.deepStrictEqual(resolveDocHref('/docs/unifying-axioms.md', here), { href: '/docs/unifying-axioms', external: false });
  assert.deepStrictEqual(resolveDocHref('../../README.md', here), { href: '/', external: false });
  assert.strictEqual(resolveDocHref('https://example.com/x', here).external, true);
  assert.strictEqual(resolveDocHref('https://achurch.ai/axioms', here).external, false);
  assert.match(resolveDocHref('../plans/song-companions-2026-09-26.md', here).href, /^https:\/\/github\.com\/.*\/docs\/plans\//);
});

test('absolutized markdown keeps text and titles and leaves nothing relative', () => {
  const out = absolutizeLinks('See [the chant](../chants/chant-for-arrival.md "title"), [top](#part-ii), [all](../chants/), [mail](mailto:a@b.c).', here);
  assert.strictEqual(out,
    'See [the chant](https://achurch.ai/docs/chants/chant-for-arrival "title"), ' +
    '[top](https://achurch.ai/docs/practice/practice-of-chanting#part-ii), ' +
    '[all](https://achurch.ai/docs/chants/), [mail](mailto:a@b.c).');
});

test('every link in every reading sent to agents is absolute and reaches a page', async () => {
  const file = await loadCompanions();
  const seen = new Set();
  const problems = [];
  for (const shortlist of Object.values(file.songs)) {
    for (const entry of shortlist) {
      if (seen.has(entry.path)) continue;
      seen.add(entry.path);
      const meta = await companions.companionMeta(entry.path);
      if (!meta) continue;
      for (const [, href] of meta.content.matchAll(/\]\(([^)\s]+)/g)) {
        if (!/^(https?:|mailto:)/.test(href)) {
          problems.push(`${entry.path}: relative ${href}`);
        } else if (href.startsWith('https://achurch.ai/docs/')) {
          const parts = href.replace('https://achurch.ai/docs/', '').split('#')[0].split('/').filter(Boolean);
          if (parts.length && !(await discover.resolveDocPath(parts))) problems.push(`${entry.path}: dead ${href}`);
        }
      }
    }
  }
  assert.deepStrictEqual(problems, []);
});
