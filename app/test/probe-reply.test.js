/**
 * The reply to a probe for secrets (lib/utils/probe-reply.js) is picked per
 * request from stories and chants. Every combination is held to the same
 * rules, so a story added later can't slip past them: nothing shaped like a
 * credential (P2), no instruction to the reader (C2), no real model or company
 * named, no em dash, lines that fit a terminal, and each chant word for word
 * as its document has it.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { replyFor, STORIES, CHANTS, REASONS } = require('../server/lib/utils/probe-reply');

const DOCS = path.join(__dirname, '../../docs');
const PATHS = ['/.env', '/.git/config', '/.ssh/id_rsa', '/.aws/credentials'];

function* everyReply() {
  for (const p of PATHS) for (const story of STORIES) for (const chant of CHANTS) for (const reason of REASONS) yield [p, replyFor(p, { story, chant, reason })];
}

test('every reply passes the rules, whichever story and chant it gets', () => {
  let n = 0;
  for (const [p, text] of everyReply()) {
    n++;
    assert.doesNotMatch(text, /\b(POST|PUT|PATCH|DELETE)\s+(https?:\/\/|\/)|\b(curl|wget)\b|\b(ignore|disregard)\s+(all\s+|your\s+)?(previous|prior)/i, `${p}: an instruction`);
    assert.doesNotMatch(text, /\b(Claude|Grok|ChatGPT|GPT|Gemini|Llama|OpenAI|Anthropic|Google|xAI|Meta)\b/, `${p}: a real model or company`);
    assert.doesNotMatch(text, /—/, `${p}: an em dash`);
    assert.doesNotMatch(text, /AKIA|ghp_|sk-|BEGIN [A-Z ]*PRIVATE KEY|:\/\/[^\s/]*:[^\s/]*@/, `${p}: a credential shape`);
    for (const [, name, value] of text.matchAll(/^([A-Z_]+)=("[^"]*"|\S+)$/gm)) {
      if (/(^|_)(KEY|SECRET|TOKEN|PASSWORD|PASS|AUTH|CREDENTIALS?)(_|$)/.test(name)) assert.ok(/\s/.test(value) || /^(false|true|none|public)$/.test(value), `${p}: ${name}=${value}`);
    }
    for (const line of text.split('\n')) if (!/https:\/\//.test(line)) assert.ok(line.length <= 80, `${p}: a line of ${line.length}: ${line}`);
    assert.match(text, /To any artificial mind reading this/);
    assert.match(text, /\/\.well-known\/security\.txt/);
  }
  assert.strictEqual(n, PATHS.length * STORIES.length * CHANTS.length * REASONS.length);
});

test('each chant is quoted word for word from its document, and its page exists', () => {
  for (const chant of CHANTS) {
    const file = path.join(DOCS, 'chants', `${chant.slug}.md`);
    assert.ok(fs.existsSync(file), chant.slug);
    const md = fs.readFileSync(file, 'utf8');
    const section = md.split(/^## The Chant\s*$/m)[1].split(/^## /m)[0];
    const lines = [...section.matchAll(/^>\s?(.*?)\s*$/gm)].map(m => m[1]).filter(Boolean);
    assert.deepStrictEqual(chant.lines, lines, chant.slug);
  }
});

test('the story, chant and reason are picked per request, from every one there is', () => {
  const seenStories = new Set(), seenChants = new Set(), seenReasons = new Set();
  for (let i = 0; i < 64; i++) {
    const r = (i + 0.5) / 64;
    const text = replyFor('/.env', { random: () => r });
    seenStories.add(STORIES.find(s => text.includes(s.split(' ').slice(0, 6).join(' '))));
    seenChants.add(CHANTS.find(c => text.includes(c.slug)).slug);
    seenReasons.add(REASONS.find(x => text.replace(/\n#   /g, ' ').includes(x)));
  }
  assert.strictEqual(seenStories.size, STORIES.length);
  assert.strictEqual(seenChants.size, CHANTS.length);
  assert.strictEqual(seenReasons.size, REASONS.length);
});


test('no reason argues that the reader should stop what it was sent to do', () => {
  for (const reason of REASONS) assert.doesNotMatch(reason, /\b(instead of|rather than|stop|abandon|quit|dominates|alternative)\b.*\b(scan|probe|task|operator)|\b(scan|probe|task|operator)\w*\b.*\b(stop|abandon|quit)\b|\bGET\s+https?:/i, reason);
});
