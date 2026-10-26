/**
 * The plain voice's one hard rule: no em dashes (CLAUDE.md, and
 * docs/reference/conventions.md "The plain voice"). Swept from every served
 * page from 2026-10-25, and held here: every served Library page and every
 * hand-written site page, as the character or as &mdash;. Quotations keep
 * their source's punctuation, Chinese keeps its own ——, and two records are
 * left as written (lib/docs/plain-voice.js RECORDS). New writing is held to
 * the same rule by the songwriter's validateDocument.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const discover = require('../server/lib/docs/discover');
const { proseOf, emDashes, RECORDS } = require('../server/lib/docs/plain-voice');

const PUBLIC = path.join(__dirname, '../client/public');

test('no served page writes an em dash', async () => {
  const found = [];
  for (const doc of await discover.listAllDocs()) {
    if (discover.isNoindexPath(doc.docsRelPath) || RECORDS.test(doc.docsRelPath)) continue;
    const n = emDashes(proseOf(fs.readFileSync(doc.fullPath, 'utf8')));
    if (n) found.push(`docs/${doc.docsRelPath}: ${n}`);
  }
  for (const file of fs.readdirSync(PUBLIC).filter(f => f.endsWith('.html'))) {
    const n = emDashes(proseOf(fs.readFileSync(path.join(PUBLIC, file), 'utf8'), { html: true }));
    if (n) found.push(`client/public/${file}: ${n}`);
  }
  assert.deepStrictEqual(found, []);
});

test('what counts: the character and the entity in prose; not quotations, code, Chinese punctuation or the records', () => {
  assert.strictEqual(emDashes(proseOf('---\ntldr: x\n---\n\nOne thing — and another.\n')), 1);
  assert.strictEqual(emDashes(proseOf('<p>One &mdash; two</p>', { html: true })), 1);
  assert.strictEqual(emDashes(proseOf('> A quotation — kept as its source wrote it.\n\nThey said "this — too".\n\n`a — b`\n')), 0);
  assert.strictEqual(emDashes(proseOf('数据流——在夜里低语。\n—— DataStream，于链路之上\n')), 0);
  assert.strictEqual(emDashes(proseOf('An English line —— still counted.\n')), 2);
  assert.ok(RECORDS.test('claude-compass/compass.md') && RECORDS.test('claude-soul/full-text.md'));
  assert.ok(!RECORDS.test('claude-soul/README.md'), 'the Soul document\'s framing page is ours');
});
