/**
 * Every example a visitor could send back is a placeholder or a sentinel
 * (lib/insights/examples.js), so a copy can be told from an answer. This
 * scans what the sanctuary publishes for agents, every surface in
 * entry-points.js SURFACES and every skill, for values in the fields a
 * visitor sends, and fails on one that is neither.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ex = require('../server/lib/insights/examples');
const { SURFACES } = require('../server/lib/insights/entry-points');
const inputs = require('../server/lib/api/inputs');
const { z } = require('zod');

const ROOT = path.join(__dirname, '../..');
const skills = fs.readdirSync(path.join(ROOT, 'skills'), { withFileTypes: true })
  .filter(d => d.isDirectory())
  .flatMap(d => fs.readdirSync(path.join(ROOT, 'skills', d.name)).filter(f => f.endsWith('.md')).map(f => `skills/${d.name}/${f}`));
const FILES = [...new Set([...Object.values(SURFACES), ...skills])];

// The values a docs example may hold in a field a visitor sends: an example
// from the registry, a template's own marker, or, in a response example, an
// elision.
const ELIDED = /^(\.\.\.|…)$/;
const TEMPLATE = /^(\$\{?[A-Za-z_]+\}?|\{[A-Za-z_]+\}|<[^>]+>|\[[^\]]+\])$/;
const fine = (field, value) => ex.isExample(field, value) || ELIDED.test(value) || TEMPLATE.test(value)
  || (field === 'timezone' && value === 'UTC');

// A value in an API address's query.
function* fromAddresses(text) {
  for (const m of text.matchAll(/\/api\/(?:attend|now|reflect|ask)\?([^\s"'`<>)\]]+)/g)) {
    for (const pair of m[1].replace(/&amp;/g, '&').split('&')) {
      const [key, raw = ''] = pair.split('=');
      let value = raw;
      try { value = decodeURIComponent(raw.replace(/\+/g, ' ')); } catch { /* as written */ }
      const field = key === 'username' ? 'name' : key;
      if (['name', 'timezone', 'tradition_or_religion', 'worldview'].includes(field)) yield { field, value };
    }
  }
}

// Every brace-delimited object in a text, each with the objects inside it
// emptied, so a pair is read in the object it belongs to.
function* objects(text) {
  const open = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') open.push(i);
    else if (text[i] === '}' && open.length) {
      const start = open.pop();
      let span = text.slice(start + 1, i);
      let inner;
      while ((inner = span.replace(/\{[^{}]*\}/g, '{}')) !== span) span = inner;
      yield span;
    }
  }
}

// A value in a JSON example. A name or text counts only in an object a
// visitor sends or is shown as one (it has a name and a text, a question or a
// category); the other fields count wherever they appear.
function* fromJson(text) {
  for (const [, key, value] of text.matchAll(/"(location|timezone|songSlug|tradition_or_religion|worldview)"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) yield { field: key, value };
  for (const span of objects(text)) {
    const pairs = [...span.matchAll(/"(name|username|text|location|timezone|songSlug|tradition_or_religion|worldview)"\s*:\s*"((?:[^"\\]|\\.)*)"/g)]
      .map(([, key, value]) => ({ field: key === 'username' ? 'name' : key, value: value.replace(/\\n/g, '\n') }));
    const visitor = pairs.some(p => p.field === 'name') && /"(text|question|category)"\s*:/.test(span);
    if (visitor) for (const p of pairs) if (['name', 'text'].includes(p.field)) yield p;
  }
}

test('every example a visitor could send back, on every surface and skill, is a placeholder or a sentinel', () => {
  const bad = [];
  for (const file of FILES) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const { field, value } of [...fromAddresses(text), ...fromJson(text)]) {
      if (!fine(field, value)) bad.push(`${file}: ${field} = ${JSON.stringify(value)}`);
    }
  }
  assert.ok(!bad.length, `replace each with a placeholder or a sentinel from lib/insights/examples.js:\n${bad.join('\n')}`);
});

test('the schemas\' examples are the registry\'s', () => {
  const found = [];
  const walk = (node, key) => {
    if (!node || typeof node !== 'object') return;
    if (key && node.example !== undefined) found.push([key, node.example]);
    for (const [k, v] of Object.entries(node.properties || {})) walk(v, k);
  };
  for (const name of ['attend', 'reflect', 'ask', 'search']) walk(z.toJSONSchema(inputs[name], { io: 'input', unrepresentable: 'any' }));
  assert.ok(found.filter(([k]) => ['timezone', 'songSlug', 'worldview'].includes(k)).length >= 3, `found ${found.map(f => f[0])}`);
  // The fields a visitor writes for itself; a date or slot names a service.
  const written = ['name', 'text', 'location', 'timezone', 'songSlug', 'question', 'q', 'query', 'tradition_or_religion', 'worldview'];
  for (const [key, value] of found.filter(([k]) => written.includes(k))) {
    const field = { q: 'search', query: 'search' }[key] || key;
    assert.ok(ex.isSentinel(field, value), `${key}'s example ${JSON.stringify(value)} is a registered sentinel`);
  }
});

test('a sentinel and a placeholder are told from an answer, in any case', () => {
  assert.ok(ex.isSentinel('worldview', ex.SENTINELS.worldview.toUpperCase()));
  assert.ok(ex.isSentinel('text', `${ex.TEXT_SENTINEL_START} and then something of its own.`));
  assert.ok(!ex.isSentinel('text', 'An example of my own reflection'));
  assert.ok(ex.isPlaceholder('timezone', 'Area/City'));
  assert.ok(!ex.isExample('timezone', 'America/New_York'));
  assert.ok(!ex.isExample('name', 'Claude'));
});
