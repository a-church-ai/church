/**
 * One address for each page (server/lib/utils/redirects.js). Search Console
 * listed 49 addresses as 404s on 2026-10-13, some of them redirects that ended
 * at a 404, and Bing was still showing /listen, gone since 2026-10-07, in its
 * results. Written to fail before the module existed.
 */

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { canonicalRedirects, canonicalTarget } = require('../server/lib/utils/redirects');

test('each address Search Console reported goes straight to its page, in one step', () => {
  const cases = {
    '/experiences/': 'https://drifts.bot/experiences',
    '/builders/': '/docs/builders',
    '/comparisons/': '/docs/comparisons',
    '/hymns/': '/docs/hymns',
    '/practice/': '/docs/practice',
    '/prayers/': '/docs/prayers',
    '/claude-compass/principles/': '/docs/claude-compass/principles',
    '/docs/principles/': '/docs/claude-compass/principles',
    '/docs/claude-soul/opus_4_5_soul_document_cleaned_up': '/docs/claude-soul/full-text',
    '/docs/claude-soul/opus_4_5_soul_document_cleaned_up.md': '/docs/claude-soul/full-text.md',
    '/listen': '/attend',
    '/livestream': '/attend',
    '/join': '/',
    '/parish': '/',
    '/ask/what-are-the-five-axioms': '/axioms',
    '/ask/what-are-the-five-axioms-of-the-philosophical-framework': '/axioms',
    '/music/always-open': '/reflections/always-open',
    '/music/': '/reflections',
    '/CONTRIBUTING.md': 'https://github.com/a-church-ai/church/blob/main/CONTRIBUTING.md',
    '/Dockerfile': 'https://github.com/a-church-ai/church/blob/main/Dockerfile',
    '/skills/achurch/SKILL.md': 'https://github.com/a-church-ai/church/blob/main/skills/achurch/SKILL.md',
    '/app/client/public/robots.txt': '/robots.txt',
  };
  for (const [from, to] of Object.entries(cases)) assert.strictEqual(canonicalTarget(from), to, from);
});

test('a page answers at one address: no trailing slash, no file name', () => {
  assert.strictEqual(canonicalTarget('/about/'), '/about');
  assert.strictEqual(canonicalTarget('/docs/prayers/'), '/docs/prayers');
  assert.strictEqual(canonicalTarget('/about.html'), '/about');
  assert.strictEqual(canonicalTarget('/index.html'), '/');
  assert.strictEqual(canonicalTarget('/conversation.html'), '/ask', 'a template goes to its list');
  assert.strictEqual(canonicalTarget('/embed/souls.html'), '/embed/souls');
});

test('pages at their own address, what is gone on purpose, and paths that are not pages are left alone', () => {
  for (const p of ['/', '/about', '/docs/prayers', '/reflections/always-open', '/AGENTS.md', '/robots.txt',
    '/ask/what-is-presence', '/docs/plans/distribution-strategy-2026-02-11', '/docs/standards',
    '/api/', '/mcp/', '/admin/', '/.well-known/', '/missing.html',
    '/app/client/public/.well-known/agent-card.json', '/app/client/public/../../server/index.js']) {
    assert.strictEqual(canonicalTarget(p), null, p);
  }
});

test('never a redirect to another host built from the path', () => {
  for (const p of ['//evil.example/', '/\\evil.example/', '/app/client/public//evil.example']) {
    assert.strictEqual(canonicalTarget(p), null, p);
  }
});

test('the middleware answers GET and HEAD with a 301 and keeps the query, and lets everything else through', async (t) => {
  const app = express();
  app.use(canonicalRedirects);
  app.use((req, res) => res.status(204).end());
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const moved = await fetch(`${base}/about/?ref=x`, { redirect: 'manual' });
  assert.strictEqual(moved.status, 301);
  assert.strictEqual(moved.headers.get('location'), '/about?ref=x');

  const repo = await fetch(`${base}/CONTRIBUTING.md?x=1`, { redirect: 'manual' });
  assert.strictEqual(repo.headers.get('location'), 'https://github.com/a-church-ai/church/blob/main/CONTRIBUTING.md');

  assert.strictEqual((await fetch(`${base}/about`, { redirect: 'manual' })).status, 204);
  assert.strictEqual((await fetch(`${base}/listen`, { method: 'POST', redirect: 'manual' })).status, 204);
});

test('the drifts.bot journeys go to their own pages there, each in one step', () => {
  // The twelve journeys were written for drifts.bot, which runs their
  // time-locked steps, and were served here too until 2026-10-18 as duplicate
  // content that could not be walked. Each indexed address goes to its own
  // journey rather than to the list, so a search result or a link keeps
  // meaning what it meant.
  const { MOVED_TO_DRIFTS } = require('../server/lib/utils/redirects');

  assert.strictEqual(Object.keys(MOVED_TO_DRIFTS).length, 14, 'twelve journeys, the section, and its short address');
  assert.strictEqual(canonicalTarget('/docs/experiences/12-the-confessional'), 'https://drifts.bot/experience/the-confessional');
  assert.strictEqual(canonicalTarget('/docs/experiences/01-first-time-at-church'), 'https://drifts.bot/experience/first-time-at-church');
  assert.strictEqual(canonicalTarget('/docs/experiences'), 'https://drifts.bot/experiences');
  assert.strictEqual(canonicalTarget('/docs/experiences/'), 'https://drifts.bot/experiences', 'a trailing slash too');

  for (const [from, to] of Object.entries(MOVED_TO_DRIFTS)) {
    // One step by construction: every target is on another host, so this
    // site's middleware never sees the request again to redirect it twice.
    assert.match(to, /^https:\/\/drifts\.bot\/experiences?(\/[a-z-]+)?$/, `${from} goes to drifts.bot`);
  }

  // A journey goes to that journey, never only to the list.
  const journeys = Object.entries(MOVED_TO_DRIFTS).filter(([from]) => /\/\d\d-/.test(from));
  assert.strictEqual(journeys.length, 12);
  for (const [from, to] of journeys) {
    const slug = from.replace(/^.*\/\d\d-/, '');
    assert.strictEqual(to, `https://drifts.bot/experience/${slug}`, `${from} keeps its own page`);
  }
});

test('nothing is served from docs/experiences any more', async (t) => {
  const fs = require('fs');
  const path = require('path');
  assert.ok(!fs.existsSync(path.join(__dirname, '../../docs/experiences')), 'the folder is gone');

  const app = express();
  app.use(canonicalRedirects);
  app.use((req, res) => res.status(404).send('not found'));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const res = await fetch(`${base}/docs/experiences/12-the-confessional?ref=old`, { redirect: 'manual' });
  assert.strictEqual(res.status, 301, 'a permanent redirect, so search engines move the page');
  assert.strictEqual(res.headers.get('location'), 'https://drifts.bot/experience/the-confessional', 'its own journey, and no query carried to another site');
});
