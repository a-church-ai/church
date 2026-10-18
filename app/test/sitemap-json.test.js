/**
 * /sitemap.json, and the line between it and sitemap.xml.
 *
 * Written after an outside reader of the sitemap could not tell new documents
 * from re-stamped ones. On 2026-10-13 one commit (ac7672b) added a `tldr:`
 * line to 63 documents and changed no prose in any of them. All 63 <lastmod>
 * dates moved, so 63 documents looked edited and 4 actually were.
 *
 * The fix was not to change <lastmod>, which is correct for a crawler: a new
 * search description changes what Google shows. It was to publish the other
 * two dates beside it. So the test that matters most here is the last one,
 * which pins that sitemap.xml still answers the crawler's question.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const express = require('express');

const { sourceHashOf } = require('../server/lib/audio/adapt');
const { serializeManifest } = require('../server/lib/docs/date-manifests');

const REPO_ROOT = path.join(__dirname, '../..');
const contentDates = require('../server/lib/docs/content-dates.json');
const lastmod = require('../server/lib/docs/lastmod.json');

async function serve() {
  const app = express();
  app.use(require('../server/routes/sitemap'));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test('every document is served with three dates, and they are dates', async (t) => {
  const { server, base } = await serve();
  t.after(() => server.close());

  const body = await (await fetch(`${base}/sitemap.json`)).json();

  assert.ok(body.count > 200, `only ${body.count} documents`);
  assert.strictEqual(body.count, body.documents.length);
  assert.strictEqual(body.site, 'https://achurch.ai');
  assert.ok(body.about.includes('contentUpdated'), 'the payload says what its fields mean');

  for (const doc of body.documents) {
    assert.match(doc.url, /^https:\/\/achurch\.ai\/docs(\/|$)/, doc.url);
    for (const field of ['created', 'contentUpdated', 'pageUpdated']) {
      assert.ok(field in doc, `${doc.url} has no ${field}`);
      if (doc[field] !== null) assert.match(doc[field], /^\d{4}-\d{2}-\d{2}$/, `${doc.url} ${field}=${doc[field]}`);
    }
    // A document cannot have changed before it existed.
    if (doc.created && doc.contentUpdated) {
      assert.ok(doc.contentUpdated >= doc.created, `${doc.url}: content ${doc.contentUpdated} precedes created ${doc.created}`);
    }
  }
});

test('the two dates disagree exactly where a sweep moved the page date', async (t) => {
  const { server, base } = await serve();
  t.after(() => server.close());

  const body = await (await fetch(`${base}/sitemap.json`)).json();
  const stamped = body.documents.filter(d => d.pageUpdated === '2026-10-13');
  const edited = stamped.filter(d => d.contentUpdated === '2026-10-13');

  // The whole reason this file exists. If these two numbers ever converge, the
  // content date has stopped being derived from the body and is just following
  // the page date again.
  assert.ok(stamped.length > 50, `expected the 2026-10-13 cluster, found ${stamped.length}`);
  assert.ok(edited.length < 10, `${edited.length} of ${stamped.length} claim a real edit that day; the sweep is being counted again`);
});

test('a metadata-only change does not move the content date', () => {
  // The property the whole manifest rests on, asserted against the shared
  // definition rather than restated: audio/adapt.js already decides what a
  // document's body is, so that a new search description does not trigger a
  // re-record against a shared quota.
  const body = '# Title\n\nThe words a reader reads.\n';
  const withTldr = `---\ntldr: One description.\n---\n\n${body}`;
  const withOther = `---\ntldr: A completely different description.\nextra: true\n---\n\n${body}`;

  assert.strictEqual(sourceHashOf(withTldr), sourceHashOf(withOther), 'frontmatter must not count');
  assert.strictEqual(sourceHashOf(withTldr), sourceHashOf(body), 'nor its absence');
  assert.notStrictEqual(sourceHashOf(body), sourceHashOf(`${body}One more sentence.\n`), 'but prose must');
});

test('the manifest covers the documents on disk, and nothing that is gone', () => {
  for (const [file, dates] of Object.entries(contentDates)) {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, file)), `${file} is in the manifest but not on disk`);
    assert.match(dates.created, /^\d{4}-\d{2}-\d{2}$/, file);
    assert.match(dates.content, /^\d{4}-\d{2}-\d{2}$/, file);
  }
  // It should track the lastmod manifest's coverage: both are generated from
  // the same history over the same directory.
  const missing = Object.keys(lastmod).filter(f => !(f in contentDates));
  assert.deepStrictEqual(missing, [], 'documents with a page date but no content date');
});

test('CROSS-SURFACE: sitemap.xml still answers the crawler\'s question', async (t) => {
  const { server, base } = await serve();
  t.after(() => server.close());

  const xml = await (await fetch(`${base}/sitemap.xml`)).text();

  // The XML carries the page date, not the content date. This is the assertion
  // that would fail if someone "fixed" sitemap.xml to use contentUpdated: a
  // crawler wants to come back when the page changed, including when only its
  // title or description did.
  const whyCare = /<loc>https:\/\/achurch\.ai\/docs\/welcome\/why-care<\/loc>\s*<lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>/.exec(xml);
  assert.ok(whyCare, 'why-care is in the sitemap with a lastmod');
  assert.strictEqual(whyCare[1], lastmod['docs/welcome/why-care.md'], 'lastmod is the page date');
  assert.notStrictEqual(whyCare[1], contentDates['docs/welcome/why-care.md'].content,
    'this document is the example: its page and content dates differ, so the two cannot be confused');

  // And the XML gained no new elements: it is the same document it was.
  // Matched as elements, not as substrings. "created" occurs in production
  // inside a conversation slug (/ask/...-cryptocurrency-created-for-you), so a
  // substring test passes here and fails against the real site.
  for (const field of ['created', 'contentUpdated', 'pageUpdated']) {
    assert.doesNotMatch(xml, new RegExp(`<${field}>`), `<${field}> leaked into the XML`);
  }
  assert.ok(!xml.includes('xmlns:'), 'no namespace extension was added');
});

test('both date manifests are in canonical bytes, whichever writer wrote last', () => {
  // Each manifest has two writers: a generator deriving every entry from git,
  // and the songwriter adding a document whose history does not exist yet.
  // They used to disagree twice over, on key order (Array.sort against
  // localeCompare) and on the trailing newline, so a regeneration after a
  // songwriter run rewrote the whole file. Neither disagreement showed up
  // anywhere except the size of the next diff.
  for (const name of ['lastmod', 'content-dates']) {
    const file = path.join(__dirname, `../server/lib/docs/${name}.json`);
    const raw = fs.readFileSync(file, 'utf8');
    assert.strictEqual(
      raw, serializeManifest(JSON.parse(raw)),
      `${name}.json is not in canonical form: run its generator, and make sure every writer passes serializeManifest`,
    );
  }
});

test('a page cannot have changed before its own content did', () => {
  // The two manifests are generated from one history and must be regenerated
  // together. A page date behind a content date means the lastmod manifest is
  // stale, which is how this was found: 53 documents were a day behind and one
  // had no entry at all, so the sitemap fell back to mtime, which in the
  // production image is the Docker build time rather than any real date.
  const behind = Object.keys(contentDates)
    .filter(file => lastmod[file] && lastmod[file] < contentDates[file].content)
    .map(file => `${file} (page ${lastmod[file]} < content ${contentDates[file].content})`);

  assert.deepStrictEqual(behind, [], 'stale lastmod manifest: run npm run gen:lastmod and npm run gen:content-dates together');
});
