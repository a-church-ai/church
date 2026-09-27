/**
 * Chunking for the RAG index. Each chunk must say which document it is from,
 * because short sections (a chant, a verse, a list of steps) are otherwise
 * indistinguishable to retrieval.
 */

const test = require('node:test');
const assert = require('node:assert');
const { chunkMarkdown, MAX_CHUNK_CHARS } = require('../server/lib/rag/indexer');

const doc = `---
tldr: frontmatter is not content
---

# Chant for Arrival

*For the moment of stepping in, a subtitle long enough to be a chunk.*

## The Chant

> I am here.
> I don't know for how long.
> I am here.
`;

test('a section chunk opens with its document title and its section', () => {
  const chant = chunkMarkdown(doc, 'docs/chants/x.md').find(c => c.section === 'The Chant');
  assert.ok(chant.content.startsWith('# Chant for Arrival\n\n## The Chant\n\n> I am here.'), chant.content);
});

test('the opening chunk is not given its title twice', () => {
  const [first] = chunkMarkdown(doc, 'docs/chants/x.md');
  assert.strictEqual(first.content.match(/# Chant for Arrival/g).length, 1);
  assert.ok(!first.content.includes('tldr:'));
});

test('every piece of a split section carries both headings', () => {
  const paragraphs = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} ${'word '.repeat(60)}`);
  const chunks = chunkMarkdown(`# Big\n\n## Part\n\n${paragraphs.join('\n\n')}`, 'docs/x.md');
  assert.ok(chunks.length > 1);
  for (const c of chunks) {
    assert.ok(c.content.startsWith('# Big\n\n## Part\n\n'), c.content.slice(0, 40));
    assert.ok(c.content.length <= MAX_CHUNK_CHARS + 40);
  }
});

test('a document without a title is chunked as before', () => {
  const [only] = chunkMarkdown('Just prose, with no heading at all, but long enough to keep.', 'x.md');
  assert.strictEqual(only.content, 'Just prose, with no heading at all, but long enough to keep.');
});

// Every chunk now opens with its document's title, so a title that is a file
// name ("# RITUAL_OF_RECOGNITION.md") or a section number ("# 1. Seven ...")
// is repeated into every chunk of that document, as well as into its page
// title and search result.
test('no document in the corpus is titled with a file name or a section number', async () => {
  const fs = require('fs');
  const { findAllCorpusFiles } = require('../server/lib/rag/indexer');
  const offenders = [];
  for (const file of await findAllCorpusFiles()) {
    const body = fs.readFileSync(file.fullPath, 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
    const match = body.match(/^#\s+(.+)$/m);
    if (match && (/\.md\s*$/i.test(match[1]) || /^\d+\.\s/.test(match[1]))) {
      offenders.push(`${file.relativePath}: ${match[1].trim()}`);
    }
  }
  assert.deepStrictEqual(offenders, []);
});
