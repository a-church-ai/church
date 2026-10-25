/**
 * The plain voice's one hard rule, no em dashes (CLAUDE.md, and
 * docs/reference/conventions.md "The plain voice"), read the same way by the
 * test that holds it (test/plain-voice.test.js) and the report that measures
 * the rest (scripts/style-report.js).
 *
 * Prose is a page's own writing: frontmatter, code, HTML markup, scripts and
 * styles are not, and neither are quotations, a blockquote or words inside
 * quotation marks, which keep their source's punctuation. Two sections are
 * records, left as written: the Claude Compass (CLAUDE.md: "left as written
 * because they are a record") and the Soul document's full text, which is
 * someone else's.
 */

const { splitFrontmatter } = require('./tldr');

const RECORDS = /^claude-compass\/|^claude-soul\/(?!readme\.md$)/i;

function proseOf(text, { html = false } = {}) {
  let body = html
    ? text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, ' ').replace(/<head[\s\S]*?<\/head>/gi, ' ').replace(/<[^>]+>/g, ' ')
    : splitFrontmatter(text).body.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ').replace(/^\s*>.*$/gm, ' ');
  body = body.replace(/"[^"\n]*"/g, ' ').replace(/“[^”\n]*”/g, ' ');
  return body.replace(/\]\([^)]*\)/g, ']').replace(/[*_]/g, '');
}

// The English em dash, as the character or an entity. A double dash on a line
// written in Chinese is that language's own punctuation (——), not the tell,
// and a contributor's Chinese keeps it.
const CJK = /[\u3400-\u9fff\uff00-\uffef]/;
const emDashes = prose => (prose
  .split('\n').map(line => (CJK.test(line) ? line.replace(/——/g, ' ') : line)).join('\n')
  .match(/—|&mdash;|&#8212;/g) || []).length;

// Sentences of three words or more: a heading, a list label or a lone word is
// not one.
const sentencesOf = prose => prose
  .replace(/^\s*(?:#{1,6}|[-*+]|\d+[.)]|\|)\s.*$/gm, '\n\n')
  .split(/(?<=[.!?])\s+|\n{2,}/)
  .map(s => s.replace(/\s+/g, ' ').trim())
  .filter(s => s.split(' ').length >= 3);

module.exports = { proseOf, emDashes, sentencesOf, RECORDS };
