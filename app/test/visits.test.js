/**
 * The website's visits (lib/insights/visits.js, client/public/visits.js):
 * what a page may report and what is dropped, who is asked first, the
 * section list against the markup, and the report's view of them. No network.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'achurch-visits-'));
delete process.env.DEV_COUNTRY;

const { checkVisit, recordVisit, needsNotice } = require('../server/lib/insights/visits');
const { PLACEMENTS, FEATURES } = require('../server/lib/insights/placements');
const client = require('../client/public/visits.js');

const ID = '0b6f7b3e-2c4d-4e5f-8a9b-0c1d2e3f4a5b';
const VIEW = '1c7a8b4f-3d5e-4f60-9b0c-1d2e3f4a5b6c';

test('a page reports only what it may: no query, no text, known names only, and only a view held three seconds', () => {
  const { visitor, rows } = checkVisit({ visitor: ID, rows: [
    { kind: 'page', view: VIEW, path: '/docs/prayers/prayer-of-gratitude?utm_source=x&q=private words', seconds: 42, scroll: 180, shown: ['footer', 'not-a-section'], placement: 'doc-related', features: ['ask', 'steal-cookies'], text: 'anything typed', first: true, source: 'search', referrer: 'www.google.com', device: 'phone', browser: 'safari', name: 'Wren' },
    { kind: 'page', view: VIEW, path: '/', seconds: 2 },
    { kind: 'listen', view: VIEW, event: 'started', piece: '/music/the-octopus-prayer', placement: 'player', startMs: 840 },
    { kind: 'service', view: VIEW, event: 'begun', date: '2026-11-01', slot: '08:00 to 12:00', part: 1, parts: 5 },
    { kind: 'listen', view: 'not-a-uuid', event: 'started' },
    { kind: 'unknown', view: VIEW }
  ] });
  assert.strictEqual(visitor, ID);
  assert.strictEqual(rows.length, 3, 'the short view, the bad id and the unknown kind dropped');
  const page = rows[0];
  assert.strictEqual(page.path, '/docs/prayers/prayer-of-gratitude', 'never the query string');
  assert.strictEqual(page.scroll, 100);
  assert.deepStrictEqual(page.shown, ['footer']);
  assert.deepStrictEqual(page.features, ['ask']);
  assert.ok(!('text' in page) && !('name' in page), 'nothing a visitor wrote');
  assert.strictEqual(page.source, 'search');
  assert.strictEqual(rows[1].startMs, 840);
  assert.strictEqual(rows[2].slot, '08:00 to 12:00');
  assert.strictEqual(checkVisit({ visitor: 'not-an-id', rows: [] }).visitor, null);
  assert.match(checkVisit({ rows: new Array(21).fill({}) }).problem, /at most 20/);
});

test('rows are kept with the server\'s minute, and never an address', async () => {
  const kept = await recordVisit(checkVisit({ visitor: ID, rows: [{ kind: 'page', view: VIEW, path: '/attend', seconds: 12 }] }), new Date('2026-11-01T10:15:42Z'));
  assert.strictEqual(kept, 1);
  const line = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'visits', '2026-11-01.jsonl'), 'utf8').trim());
  assert.strictEqual(line.at, '2026-11-01T10:15');
  assert.strictEqual(line.visitor, ID);
  assert.ok(!('ip' in line) && !('userAgent' in line));
});

test('the EU, the EEA, the UK and anywhere unknown are asked first; elsewhere is not', () => {
  for (const c of ['DE', 'FR', 'IE', 'NO', 'IS', 'LI', 'GB', 'gb']) assert.ok(needsNotice(c), c);
  for (const c of ['XX', 'T1', '', undefined, 'not a code']) assert.ok(needsNotice(c), `unknown: ${c}`);
  for (const c of ['US', 'CA', 'BR', 'JP', 'IN', 'CH', 'AU']) assert.ok(!needsNotice(c), c);
});

test('an id may be made only once it is known the visitor need not be asked, or after Count me in', () => {
  const { mayIdentify } = client;
  assert.strictEqual(mayIdentify({ off: false, notice: null, consent: null }), false, 'not before the server answers');
  assert.strictEqual(mayIdentify({ off: false, notice: 'no', consent: null }), true);
  assert.strictEqual(mayIdentify({ off: false, notice: 'yes', consent: null }), false, 'asked, not answered');
  assert.strictEqual(mayIdentify({ off: false, notice: 'yes', consent: 'yes' }), true);
  assert.strictEqual(mayIdentify({ off: false, notice: 'no', consent: 'no' }), false, 'No thanks holds anywhere');
  assert.strictEqual(mayIdentify({ off: true, notice: 'no', consent: 'yes' }), false, 'counting off holds over everything');
});

test('where a visit came from, by the referring site or its campaign tag', () => {
  const { sourceOf, deviceOf, browserOf, serviceOf } = client;
  assert.strictEqual(sourceOf('https://www.google.com/', 'achurch.ai'), 'search');
  assert.strictEqual(sourceOf('https://gemini.google.com/app', 'achurch.ai'), 'assistant');
  assert.strictEqual(sourceOf('https://chatgpt.com/', 'achurch.ai'), 'assistant');
  assert.strictEqual(sourceOf('https://m.youtube.com/watch?v=1', 'achurch.ai'), 'youtube');
  assert.strictEqual(sourceOf('https://podcasts.apple.com/x', 'achurch.ai'), 'podcast');
  assert.strictEqual(sourceOf('https://bsky.app/profile/x', 'achurch.ai'), 'social');
  assert.strictEqual(sourceOf('https://example.org/', 'achurch.ai'), 'site');
  assert.strictEqual(sourceOf('', 'achurch.ai'), 'direct');
  assert.strictEqual(sourceOf('https://achurch.ai/attend', 'achurch.ai'), 'direct', 'our own pages are no source');
  assert.strictEqual(sourceOf('', 'achurch.ai', 'youtube'), 'youtube', 'the campaign tag first');
  assert.strictEqual(deviceOf(390, true), 'phone');
  assert.strictEqual(deviceOf(820, true), 'tablet');
  assert.strictEqual(deviceOf(1440, false), 'desktop');
  assert.strictEqual(browserOf('Mozilla/5.0 (iPhone) AppleWebKit Version/18.0 Mobile Safari/604.1'), 'safari');
  assert.strictEqual(browserOf('Mozilla/5.0 AppleWebKit Chrome/130.0 Safari/537.36 Edg/130.0'), 'edge');
  assert.deepStrictEqual(serviceOf({ name: 'service:2026-11-01:08:00 to 12:00' }), { date: '2026-11-01', slot: '08:00 to 12:00' });
  assert.strictEqual(serviceOf({ name: 'path:night' }), null);
});

// Every data-placement in markup, and every name the list holds, match.
test('the section list and the pages name the same sections', () => {
  const root = path.join(__dirname, '..');
  const files = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) { if (!['node_modules', 'dist', 'data', 'media', 'reports'].includes(f.name)) walk(p); }
      else if (/\.(html|js)$/.test(f.name)) files.push(p);
    }
  };
  walk(path.join(root, 'client'));
  walk(path.join(root, 'server'));
  const used = new Set();
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(/data-placement="([a-z-]+)"/g)) used.add(m[1]);
    for (const m of text.matchAll(/setAttribute\('data-placement', '([a-z-]+)'\)/g)) used.add(m[1]);
  }
  assert.deepStrictEqual([...used].filter(n => !PLACEMENTS.includes(n)), [], 'named in markup but not in lib/insights/placements.js');
  assert.deepStrictEqual(PLACEMENTS.filter(n => !used.has(n)), [], 'listed but used by no page');
  assert.ok(FEATURES.every(f => fs.readFileSync(path.join(root, 'client/public/visits.js'), 'utf8').includes(`'${f}'`)), 'every feature is one visits.js records');
});

test('the report counts visitors, returning ones, each view once, and how far services are heard', async () => {
  const day = (d) => `2026-10-${d}`;
  const w = (d, rows) => { fs.mkdirSync(path.join(process.env.DATA_DIR, 'visits'), { recursive: true }); fs.writeFileSync(path.join(process.env.DATA_DIR, 'visits', `${day(d)}.jsonl`), rows.map(r => JSON.stringify(r)).join('\n') + '\n'); };
  const A = 'aaaaaaaa-0000-4000-8000-000000000001', B = 'bbbbbbbb-0000-4000-8000-000000000002';
  const v1 = 'cccccccc-0000-4000-8000-000000000001', v2 = 'cccccccc-0000-4000-8000-000000000002', v3 = 'cccccccc-0000-4000-8000-000000000003';
  fs.rmSync(path.join(process.env.DATA_DIR, 'visits', '2026-11-01.jsonl'), { force: true });
  w('20', [{ visitor: A, kind: 'page', view: 'cccccccc-0000-4000-8000-0000000000aa', path: '/', seconds: 5 }]);
  w('30', [
    { visitor: A, kind: 'page', view: v1, path: '/attend', seconds: 8, shown: ['service', 'footer'], first: true, source: 'search', device: 'phone' },
    { visitor: A, kind: 'page', view: v1, path: '/attend', seconds: 40, shown: ['service', 'footer'], placement: 'home-service', first: true, source: 'search', device: 'phone', features: ['begin-service'] },
    { visitor: A, kind: 'service', view: v1, event: 'begun', date: '2026-10-30', slot: '08:00 to 12:00', part: 1, parts: 4 },
    { visitor: A, kind: 'service', view: v1, event: 'part', date: '2026-10-30', slot: '08:00 to 12:00', part: 3, parts: 4 },
    { visitor: null, kind: 'page', view: v2, path: '/', seconds: 4 },
    { visitor: B, kind: 'page', view: v3, path: '/', seconds: 12, shown: ['home-service', 'home-ways'], first: true, source: 'youtube' },
    { visitor: B, kind: 'service', view: v3, event: 'begun', date: '2026-10-30', slot: '12:00 to 16:00', part: 1, parts: 2 },
    { visitor: B, kind: 'service', view: v3, event: 'finished', date: '2026-10-30', slot: '12:00 to 16:00', part: 2, parts: 2 },
    { visitor: B, kind: 'listen', view: v3, event: 'started', piece: '/music/x' }
  ]);
  const { serverStats } = require('../server/lib/insights/server-stats');
  const stats = await serverStats({ days: 7, now: Date.parse('2026-11-01T12:00:00Z') });
  const v = stats.visits;
  assert.strictEqual(v.visitors.value, 2);
  assert.strictEqual(v.returning.value, 1, 'A was here before the window');
  assert.strictEqual(v.pageViews.value, 3, 'v1 sent twice, counted once');
  assert.strictEqual(v.unjoined.value, 1);
  assert.strictEqual(v.likelyPeople.value, 2);
  assert.deepStrictEqual(v.sources.value, [{ key: 'search', count: 1 }, { key: 'youtube', count: 1 }]);
  assert.strictEqual(v.services.begun.value, 2);
  assert.strictEqual(v.services.finished.value, 1);
  assert.deepStrictEqual(v.services.furthestPart.value, [{ part: 2, count: 1 }, { part: 3, count: 1 }]);
  assert.deepStrictEqual(v.placements.value.find(p => p.key === 'service'), { key: 'service', shown: 1, followed: 0, to: [] });
  // Which page each section's links led to, so the home page's lines can be told apart.
  assert.deepStrictEqual(v.placements.value.find(p => p.key === 'home-service'), { key: 'home-service', shown: 1, followed: 1, to: [{ key: '/attend', count: 1 }] });
  assert.deepStrictEqual(v.placements.value.find(p => p.key === 'home-ways'), { key: 'home-ways', shown: 1, followed: 0, to: [] });
  // And the production report says so, in one line.
  const { text } = require('../scripts/prod-report');
  assert.match(text({ site: 'https://achurch.ai', days: 7, window: { from: '2026-10-26', to: '2026-11-01' }, generatedAt: '2026-11-01T12:00:00Z', server: stats, warnings: [] }), /links followed, by section: home-service 1 \(\/attend 1\)/);
  assert.strictEqual(v.listens.started.value, 1);
});

test('the card asks without leaning: both answers look the same, and each is a full tap target', () => {
  // "Count me in" was filled and "No thanks" an outline, so accepting was the
  // stronger-looking choice (home-first-screen-2026-11-04.md). Both now take
  // their look from the rule they share; their classes are the script's hooks.
  const css = fs.readFileSync(path.join(__dirname, '../client/public/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /\.visits-(yes|no)\b[^{}]*\{/, 'no styles of their own');
  const heights = [...css.matchAll(/\.visits-card-actions button\s*\{[^}]*min-height: ([\d.]+)rem/g)].map(m => Number(m[1]));
  assert.ok(heights.length >= 2, 'the card and its phone layout');
  for (const h of heights) assert.ok(h * 16 >= 44, `${h}rem is under 44px`);
  const script = fs.readFileSync(path.join(__dirname, '../client/public/visits.js'), 'utf8');
  assert.match(script, /class="visits-yes">Count me in<\/button><button type="button" class="visits-no">No thanks<\/button>/);
});
