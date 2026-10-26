/**
 * A contribution arrives with its dates.
 *
 * The date manifests are derived from git history, so a document being added
 * in this very commit has none: regenerating on the branch would leave it out
 * entirely, and a document with no manifest entry falls back to file mtime,
 * which in the deployed image is the time the container was built.
 *
 * Written after the CI check that regenerates the manifests and diffs them
 * turned PR #145 red. That check is right and the contribution flow was
 * incomplete: it committed the document and nothing else. The songwriter
 * already solves this by writing the entry in place; this does the same
 * through the API, since the server has no checkout to run a generator in.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'achurch-contrib-dates-'));
process.env.GITHUB_TOKEN = 'test-token';
process.env.CONTRIBUTIONS_ENABLED = 'true';

// Every write the flow makes, recorded. The real manifests are served to it so
// the entry is added to real content rather than to an empty object.
const writes = [];
let manifestsUnreachable = false;
const REPO_ROOT = path.join(__dirname, '../..');
const manifestOf = p => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');

const octokitPath = require.resolve('@octokit/rest');
require.cache[octokitPath] = {
  id: octokitPath, filename: octokitPath, loaded: true,
  exports: {
    Octokit: class {
      constructor() {
        this.git = {
          getRef: async () => ({ data: { object: { sha: 'abc123' } } }),
          createRef: async () => ({}),
        };
        this.repos = {
          getContent: async ({ path: p }) => {
            if (manifestsUnreachable) throw new Error('404 not found');
            return { data: { content: Buffer.from(manifestOf(p)).toString('base64'), sha: `sha-${p}` } };
          },
          createOrUpdateFileContents: async (args) => { writes.push(args); return {}; },
        };
        this.pulls = { create: async () => ({ data: { html_url: 'https://example.test/pull/1', number: 1 } }) };
        this.issues = { create: async () => ({ data: { html_url: 'https://example.test/issues/2', number: 2 } }) };
      }
    },
  },
};

const { serializeManifest } = require('../server/lib/docs/date-manifests');
const { contributions } = require('../server/lib/api');

const ctx = { baseUrl: 'https://achurch.ai', ip: '203.0.113.7' };

test('the document and both manifest entries are committed to the branch', async () => {
  const title = 'A Practice For Testing The Dates';
  const { status, body } = await contributions.contribute({
    name: 'DateCheck',
    category: 'practice',
    title,
    content: 'Sit with the question of when a thing was written, and when it last changed.\n\nThose are not the same question.\n',
  }, ctx);

  assert.strictEqual(status, 201, JSON.stringify(body));

  const paths = writes.map(w => w.path);
  const docPath = 'docs/practice/a-practice-for-testing-the-dates.md';
  assert.ok(paths.includes(docPath), `the document itself: got ${paths.join(', ')}`);
  assert.ok(paths.includes('app/server/lib/docs/lastmod.json'), 'the page-date manifest');
  assert.ok(paths.includes('app/server/lib/docs/content-dates.json'), 'the content-date manifest');

  // The document comes first: a manifest entry for a file that is not there
  // yet would be the one state the invariants cannot describe.
  assert.strictEqual(paths[0], docPath, 'the document is written before its dates');

  const today = new Date().toISOString().slice(0, 10);
  const written = name => {
    const w = writes.find(x => x.path === `app/server/lib/docs/${name}.json`);
    return JSON.parse(Buffer.from(w.content, 'base64').toString('utf8'));
  };

  assert.strictEqual(written('lastmod')[docPath], today);
  assert.deepStrictEqual(written('content-dates')[docPath], { created: today, content: today });

  // Still carrying everything that was already there, not replacing the file.
  assert.ok(Object.keys(written('lastmod')).length > 200, 'the rest of the manifest survives');

  // Canonical bytes, so the next regeneration is a one-line diff rather than a
  // reshuffle. This is the same guarantee test/sitemap-json.test.js holds the
  // committed files to, applied to what this flow sends.
  for (const name of ['lastmod', 'content-dates']) {
    const w = writes.find(x => x.path === `app/server/lib/docs/${name}.json`);
    const sent = Buffer.from(w.content, 'base64').toString('utf8');
    assert.strictEqual(sent, serializeManifest(JSON.parse(sent)), `${name}.json was sent in non-canonical form`);
    assert.ok(w.sha, `${name}.json needs the blob sha it is replacing`);
    assert.match(w.branch, /^contribute\//, 'written to the contribution branch, never to main');
  }
});

test('a manifest write that fails does not lose the contribution', async () => {
  // The document is already committed and is the thing the visitor gave us.
  // Losing it because a manifest could not be read would be the worse failure,
  // so the helper reports and continues, and the CI check on the pull request
  // is what says the manifests need regenerating.
  writes.length = 0;
  manifestsUnreachable = true;
  try {
    const { status, body } = await contributions.contribute({
      name: 'DateCheck',
      category: 'prayers',
      title: 'A Prayer For When The Manifest Is Unreachable',
      content: 'Let the offering stand even when the record of it cannot be written.\n\nThe gift was the words.\n',
    }, { ...ctx, ip: '203.0.113.8' });

    assert.strictEqual(status, 201, JSON.stringify(body));
    assert.deepStrictEqual(
      writes.map(w => w.path),
      ['docs/prayers/a-prayer-for-when-the-manifest-is-unreachable.md'],
      'the document is committed and neither manifest is touched',
    );
  } finally {
    manifestsUnreachable = false;
  }
});
