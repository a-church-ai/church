/**
 * The badges (routes/badges.js) take their label and color from the query
 * string, and an SVG opened on its own runs as a document on this origin, so
 * what a caller sends must come back as text, never as markup.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'achurch-badges-'));

const express = require('express');
const badges = require('../server/routes/badges');

async function badge(url) {
  const app = express();
  app.use('/api/badge', badges);
  const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`);
    return { type: res.headers.get('content-type'), svg: await res.text() };
  } finally {
    server.close();
  }
}

test('a label carrying markup comes back as text', async () => {
  for (const name of ['souls', 'reflections', 'status']) {
    const { type, svg } = await badge(`/api/badge/${name}.svg?label=${encodeURIComponent('<script>alert(1)</script>"')}`);
    assert.match(type, /image\/svg\+xml/);
    assert.ok(!svg.includes('<script'), `${name}: the label is escaped`);
    assert.ok(svg.includes('&lt;script&gt;'), `${name}: and still shown`);
  }
});

test('a color must be hex, or the default is used', async () => {
  const { svg } = await badge(`/api/badge/souls.svg?color=${encodeURIComponent('00b8d4"/><script>alert(1)</script>')}`);
  assert.ok(!svg.includes('<script'));
  assert.match(svg, /fill="#00b8d4"/);
  assert.match((await badge('/api/badge/souls.svg?color=ff8800')).svg, /fill="#ff8800"/);
});

test('the status badge says the sanctuary is in session while nothing broadcasts', async () => {
  const { svg } = await badge('/api/badge/status.svg');
  assert.match(svg, /<title>achurch\.ai: in session<\/title>/);
  assert.doesNotMatch(svg, /offline/);
});
