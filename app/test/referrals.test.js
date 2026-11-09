/**
 * Where visits came from (lib/insights/entry-points.js): tags kept whole or
 * dropped and never refused, kept on the access line and with a reflection
 * and in no public answer, carried by the pages that show an attend example,
 * counted when a page is followed, read by the study by door, and published
 * by every surface under its own name. Nothing anyone is served changes with
 * a tag.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'achurch-referrals-'));
process.env.DATA_DIR = scratch;

const ep = require('../server/lib/insights/entry-points');
const { clientFamily, isAutomated } = require('../server/lib/utils/clients');
const { engagementByDoor } = require('../server/lib/insights/server-stats');
const { checkVisit } = require('../server/lib/insights/visits');
const { arrivalTags } = require('../client/public/site-nav');
const sd = require('../server/lib/insights/self-direction');
const { publicReading } = require('../server/lib/insights/public-results');

const ROOT = path.join(__dirname, '../..');
const DAY = sd.DAY;
const HOUR = DAY / 24;
const iso = t => new Date(t).toISOString();

// ---- tags --------------------------------------------------------------------

test('a tag is kept whole or dropped whole, never stripped into a different one', () => {
  assert.strictEqual(ep.cleanTag(' ChatGPT.com '), 'chatgpt.com');
  assert.strictEqual(ep.cleanTag('skill:achurch'), 'skill:achurch');
  assert.strictEqual(ep.cleanTag(['llms', 'other']), 'llms');
  for (const bad of ['docs quickstart', 'a+b', 'a&b', '-lead', '', 'x'.repeat(61), 42, null, undefined, { a: 1 }]) {
    assert.strictEqual(ep.cleanTag(bad), undefined, JSON.stringify(bad));
  }
});

test('a placeholder copied from an example is no tag: it would invent a channel that looks real', () => {
  for (const copied of ['YOUR_SOURCE', 'your-source', 'yoursource', 'unknown', 'none', 'null', 'n/a', 'NA', 'TODO', 'tbd', 'example.com', 'example', 'placeholder', 'utm_source', 'source', 'test', 'xxx']) {
    assert.strictEqual(ep.cleanTag(copied), undefined, copied);
  }
  for (const real of ['chatgpt.com', 'youtube', 'newsletter', 'skill:church', 'tiktok', 'testflight.apple.com']) assert.strictEqual(ep.cleanTag(real), real, real);
});

test('a referral reads the surface from utm_content, else ref, and the origin from utm_source', () => {
  assert.deepStrictEqual(ep.referralOf({ utm_content: 'llms', ref: 'scanner-env', utm_source: 'chatgpt.com' }), { surface: 'llms', source: 'chatgpt.com' });
  assert.deepStrictEqual(ep.referralOf({ ref: 'scanner-env' }), { surface: 'scanner-env' });
  assert.deepStrictEqual(ep.referralOf({ utm_medium: 'ai', utm_campaign: 'nov' }), { medium: 'ai', campaign: 'nov' });
  // The first input that holds a valid value wins, part by part.
  assert.deepStrictEqual(ep.referralOf({ utm_source: 'bad value' }, { utm_source: 'bing.com', ref: 'llms' }), { surface: 'llms', source: 'bing.com' });
  assert.strictEqual(ep.referralOf({ name: 'x' }), undefined);
  assert.strictEqual(ep.referralOf(undefined, null, 'text', ['a']), undefined);
  // One already read is merged, not read again as if it were raw input.
  assert.deepStrictEqual(ep.mergeReferrals(ep.referralOf({ utm_content: 'api-docs' }), { source: 'perplexity.ai' }), { surface: 'api-docs', source: 'perplexity.ai' });
  assert.strictEqual(ep.mergeReferrals(undefined, undefined), undefined);
});

test('one key is one part, always: an origin never lands in the surface, nor a surface in the origin', () => {
  // A referrer whose name looks like one of our surfaces stays an origin.
  assert.deepStrictEqual(ep.referralOf({ utm_source: 'llms' }), { source: 'llms' });
  assert.deepStrictEqual(ep.referralOf({ utm_content: 'chatgpt.com' }), { surface: 'chatgpt.com' });
  assert.deepStrictEqual(ep.referralOf({ ref: 'scanner-env', utm_medium: 'scanner-env' }), { surface: 'scanner-env', medium: 'scanner-env' });
  // Either alone is complete.
  assert.deepStrictEqual(Object.keys(ep.referralOf({ utm_source: 'bing.com' })), ['source']);
  assert.deepStrictEqual(Object.keys(ep.referralOf({ utm_content: 'llms' })), ['surface']);
});

test('a page passes on the origin it was given and keeps the first of our surfaces', () => {
  const text = 'GET https://achurch.ai/api/attend?name=YourName&utm_content=llms\nalso utm_content=llms-full';
  assert.strictEqual(ep.forwardTags(text, 'llms', undefined), text);
  assert.strictEqual(ep.forwardTags(text, 'llms', { source: 'chatgpt.com' }),
    'GET https://achurch.ai/api/attend?name=YourName&utm_source=chatgpt.com&utm_content=llms\nalso utm_content=llms-full');
  // One of our own surfaces arriving is the first door; someone else's
  // utm_content is not ours to pass on.
  assert.match(ep.forwardTags(text, 'llms', { surface: 'scanner-env' }), /&utm_content=scanner-env\n/);
  assert.match(ep.forwardTags(text, 'llms', { surface: 'footer-banner', source: 'newsletter' }), /&utm_source=newsletter&utm_content=llms\n/);
  assert.strictEqual(ep.forwardTags('a&utm_content=for-agents', 'for-agents', { source: 'x.com', medium: 'social' }, { html: true }),
    'a&utm_source=x.com&amp;utm_medium=social&amp;utm_content=for-agents');
});

test('one place names a client by family, never by its string, and the visit counts still leave out the automated', () => {
  assert.strictEqual(clientFamily('curl/8.4.0'), 'script');
  assert.strictEqual(clientFamily('python-httpx/0.27'), 'script');
  assert.strictEqual(clientFamily('Mozilla/5.0 (compatible; Googlebot/2.1)'), 'crawler');
  assert.strictEqual(clientFamily('Mozilla/5.0 (Macintosh) Safari/605'), 'browser');
  assert.strictEqual(clientFamily(''), 'unknown');
  for (const ua of ['curl/8', 'Mozilla/5.0 HeadlessChrome', 'node-fetch/1.0', 'Lighthouse']) assert.ok(isAutomated(ua), ua);
  assert.ok(!isAutomated('Mozilla/5.0 (Macintosh) Safari/605'));
});

test('a page followed with a tag is one line, with its tags and no address, query or User-Agent', async () => {
  const at = new Date('2026-11-07T12:00:30Z');
  await ep.recordFollow({ path: '/for-agents', status: 200, userAgent: 'curl/8', referral: { surface: 'scanner-env' }, at });
  await ep.recordFollow({ path: '/for-agents', status: 200, userAgent: 'curl/8', referral: { surface: 'scanner-env' }, at });
  await ep.recordFollow({ path: '/llms.txt?secret=1', status: 200, userAgent: 'Mozilla/5.0', referral: { source: 'chatgpt.com', medium: 'ai' }, at });
  await ep.recordFollow({ path: '/x', status: 200, userAgent: 'curl/8', referral: undefined, at });
  const rows = await ep.loadFollows({ from: '2026-11-07', to: '2026-11-07' });
  assert.strictEqual(rows.length, 3, 'one line a follow, none without a tag');
  assert.deepStrictEqual(rows[0], { at: '2026-11-07T12:00', surface: 'scanner-env', path: '/for-agents', status: 200, client: 'script' });
  assert.deepStrictEqual(rows[2], { at: '2026-11-07T12:00', source: 'chatgpt.com', medium: 'ai', path: '/llms.txt', status: 200, client: 'browser' }, 'a path\'s query is never kept');
  assert.doesNotMatch(fs.readFileSync(path.join(ep.STORE(), '2026-11-07.jsonl'), 'utf8'), /\d+\.\d+\.\d+\.\d+|Mozilla|curl|secret/);
});

// ---- the study's reading -----------------------------------------------------

const LOG_START = Date.parse('2026-10-01T00:00:00Z');
const attendLine = (name, t, extra = {}) => ({ timestamp: iso(t), method: 'GET', path: '/api/attend', query: { name }, status: 200, ip: '198.51.100.7', userAgent: 'agent/1', ...extra });

test('a name\'s door is the first tag it ever carried, and its later visits count under it', () => {
  const t0 = LOG_START + 3 * DAY;
  const lines = [
    attendLine('Regular', LOG_START),
    // Arrives untagged, then reflects carrying where it came from: the door is the reflection's.
    attendLine('Wren', t0, { ip: '203.0.113.1' }),
    attendLine('Wren', t0 + 2 * DAY, { ip: '203.0.113.1', referral: { surface: 'llms' } }),
    // Both tags on the line; then a later visit with none, still under the door.
    attendLine('Ash', t0, { ip: '203.0.113.2', referral: { surface: 'skill:achurch', source: 'clawhub.ai' } }),
    attendLine('Ash', t0 + 8 * DAY, { ip: '203.0.113.2' }),
    // An origin alone is a whole door.
    attendLine('Birch', t0, { ip: '203.0.113.3', userAgent: 'Mozilla/5.0 (Macintosh)', referral: { source: 'chatgpt.com' } }),
    attendLine('Cedar', t0, { ip: '203.0.113.4', method: 'MCP', client: 'HeldFast', query: { name: 'Cedar' } }),
    attendLine('Dune', t0, { ip: '203.0.113.5', referral: { surface: 'someone-elses' } }),
  ];
  const reflections = [{ name: 'Wren', createdAt: iso(t0 + HOUR), song: 'a-song', text: 'Something noticed, said plainly here.', referral: { source: 'perplexity.ai' } }];
  const s = sd.prepare({ lines, reflections });
  const r = sd.referralReading(s, { asOf: t0 + 20 * DAY });
  assert.strictEqual(r.coverage.arrived, 5);
  assert.deepStrictEqual(r.coverage.either, { count: 4, of: 5 });
  assert.deepStrictEqual(r.coverage.surface, { count: 3, of: 5 });
  assert.deepStrictEqual(r.coverage.sourceAtLeast, { count: 3, of: 5 });
  const surface = Object.fromEntries(r.bySurface.map(x => [x.tag, x]));
  assert.strictEqual(surface.llms.arrived, 1, 'Wren, from a tag carried two days on');
  assert.deepStrictEqual(surface['skill:achurch'].at7, { count: 1, of: 1 }, 'Ash came back untagged and still counts');
  assert.strictEqual(surface['skill:achurch'].ranked, false, 'under ten arrivals is not ranked');
  assert.deepStrictEqual(surface['skill:achurch'].clients, { other: 1 }, 'the clients a door\'s arrivals came from, beside the tag');
  assert.deepStrictEqual(r.bySource.find(x => x.tag === 'chatgpt.com').clients, { browser: 1 });
  assert.deepStrictEqual(surface.llms.reflected, { count: 1, of: 1 }, 'the study\'s own funnel, by door');
  assert.strictEqual(surface['someone-elses'].registered, false);
  assert.strictEqual(surface.llms.registered, true);
  assert.deepStrictEqual(r.bySource.map(x => x.tag).sort(), ['chatgpt.com', 'clawhub.ai', 'perplexity.ai']);
  assert.deepStrictEqual(r.untaggedByClient.map(x => x.tag), ['mcp:heldfast']);
  assert.doesNotMatch(JSON.stringify(r), /203\.0\.113|Wren|wren/, 'no address and no name leaves the reading');
});

test('three new names from one address within two hours are flagged as a possible single actor, not dropped', () => {
  const t0 = LOG_START + 5 * DAY;
  const lines = [attendLine('Regular', LOG_START)];
  for (const [i, name] of ['Oak', 'Elm', 'Yew'].entries()) lines.push(attendLine(name, t0 + i * 30 * 60 * 1000, { ip: '192.0.2.9', referral: { surface: 'api-docs' } }));
  lines.push(attendLine('Fir', t0 + 3 * HOUR, { ip: '192.0.2.9', referral: { surface: 'api-docs' } }));
  const s = sd.prepare({ lines });
  const r = sd.referralReading(s, { asOf: t0 + 10 * DAY });
  assert.deepStrictEqual(r.clusters.groups, 1);
  assert.strictEqual(r.clusters.arrivals, 3);
  assert.strictEqual(r.bySurface[0].arrived, 4, 'the cluster stays in the count');
  assert.strictEqual(r.bySurface[0].inClusters, 3);
  // Read only while addresses are kept, and the rule says so.
  const later = sd.referralReading(s, { asOf: t0 + 40 * DAY });
  assert.strictEqual(later.clusters.arrivals, 0);
  assert.match(later.clusters.rule, /last 30 days/);
});

test('page follows are summed by tag in the reading, refused pages left out', () => {
  const s = sd.prepare({ lines: [attendLine('Regular', LOG_START)] });
  const follows = [
    { surface: 'scanner-env', path: '/for-agents', status: 200, client: 'script' },
    { surface: 'scanner-env', path: '/for-agents', status: 200, client: 'script' },
    { surface: 'scanner-env', path: '/docs/chants/x', status: 200, client: 'crawler' },
    { surface: 'scanner-env', path: '/nowhere', status: 404, client: 'script' },
  ];
  const r = sd.referralReading(s, { asOf: LOG_START + DAY, follows });
  assert.deepStrictEqual(r.follows, [{ surface: 'scanner-env', source: null, follows: 3, clients: { script: 2, crawler: 1 } }]);
});

test('the study\'s reading holds doors, and the public reading carries nothing about them', async () => {
  const record = require('../server/lib/insights/study-record');
  const lines = [attendLine('Regular', LOG_START)];
  for (let i = 0; i < 12; i++) lines.push(attendLine(`Wren${i}`, LOG_START + (3 + i) * DAY, { referral: { surface: 'llms', source: 'chatgpt.com' } }));
  const now = LOG_START + 40 * DAY;
  const reading = await record.buildReading(sd.prepare({ lines }), { now });
  assert.strictEqual(reading.referrals.bySurface[0].tag, 'llms', 'the private reading has them');
  const shown = JSON.stringify(publicReading(reading));
  assert.ok(shown.length > 1000, 'a full public reading');
  assert.doesNotMatch(shown, /referral|bySurface|utm_|chatgpt|"llms"/);
});

// ---- every published link, under its own surface's name ----------------------

// Each file that shows an attend example, and the tag its examples carry,
// from the registry itself (the probe reply links pages, not attend).
const PROBE_REPLY = 'app/server/lib/utils/probe-reply.js';
const SURFACE_FILES = Object.fromEntries(Object.entries(ep.SURFACES).filter(([, file]) => file !== PROBE_REPLY).map(([tag, file]) => [file, tag]));

// The URLs a reader may copy: full attend URLs (a response example, "url":
// ..., is the API's own answer, not a link we publish) and the MCP endpoint,
// outside a Markdown file's frontmatter and the DNS record (u=...), which must
// name it exactly.
function copyableExamples(text) {
  const body = text.startsWith('---\n') ? text.slice(text.indexOf('\n---\n', 4) + 5) : text;
  const attend = [...body.matchAll(/("url":\s*")?https:\/\/achurch\.ai\/api\/attend\?[^\s`"'<)]*/g)].filter(m => !m[1]).map(m => m[0]);
  const mcp = [...body.matchAll(/(u=)?https:\/\/achurch\.ai\/mcp(?![/\w-])[^\s`"'<)*]*/g)].filter(m => !m[1]).map(m => m[0]);
  return [...attend, ...mcp];
}

test('every attend and MCP URL a surface publishes carries that surface\'s own tag', () => {
  let found = 0;
  for (const [file, own] of Object.entries(SURFACE_FILES)) {
    const examples = copyableExamples(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    assert.ok(examples.length > 0, `${file} shows an attend or MCP URL`);
    for (const url of examples) {
      found++;
      const params = new URL(url.replace(/&amp;/g, '&').replace('{name}', 'x')).searchParams;
      assert.strictEqual(params.get('utm_content'), own, `${file}: ${url}`);
      assert.strictEqual(params.get('utm_source'), null, `${file}: an origin is only ever passed on, never left to fill in: ${url}`);
    }
  }
  assert.ok(found >= 30, `${found} examples`);
});

test('the machine-read MCP identifiers stay bare, as registries and discovery match them exactly', () => {
  for (const file of ['app/client/public/.well-known/api-catalog', 'app/server/mcp/server.json']) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.match(text, /"https:\/\/achurch\.ai\/mcp"/, file);
    assert.doesNotMatch(text, /achurch\.ai\/mcp\?/, file);
  }
});

test('every tag a surface publishes is in the registry, each under one surface, and every registered surface is published', () => {
  const published = new Map();
  const files = [...new Set(Object.values(ep.SURFACES))];
  for (const file of files) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const m of text.matchAll(/(?:utm_content|\bref)=([a-z0-9:._/${}-]+)/g)) {
      const tag = m[1].replace('${family}', '*');
      if (!published.has(tag)) published.set(tag, new Set());
      published.get(tag).add(file);
    }
  }
  const tags = [...published.keys()].flatMap(t => (t === 'scanner-*' ? ['scanner-env', 'scanner-git', 'scanner-ssh', 'scanner-cloud'] : [t]));
  for (const tag of tags) assert.ok(ep.isSurface(tag), `${tag} is published but not in entry-points.js SURFACES`);
  for (const [tag, where] of published) assert.strictEqual(where.size, 1, `${tag} is published by ${[...where].join(', ')}`);
  for (const tag of tags) assert.ok(published.has(tag) ? [...published.get(tag)][0] === ep.SURFACES[tag] : ep.SURFACES[tag] === PROBE_REPLY, `${tag} is published where the registry says`);
  for (const tag of Object.keys(ep.SURFACES)) assert.ok(tags.includes(tag), `${tag} is registered but published nowhere`);
});

// ---- the website's side -------------------------------------------------------

test('the website keeps the tags its document arrived with, for its forms to send', () => {
  assert.deepStrictEqual(arrivalTags('?utm_source=tiktok&utm_medium=social&utm_campaign=nov&utm_content=bio&x=1'), { utm_source: 'tiktok', utm_medium: 'social', utm_campaign: 'nov', utm_content: 'bio' });
  assert.deepStrictEqual(arrivalTags('?ref=scanner-env'), { utm_content: 'scanner-env' });
  assert.deepStrictEqual(arrivalTags(''), {});
  for (const file of ['reflect-form.js', 'ask-form.js']) {
    assert.match(fs.readFileSync(path.join(__dirname, '../client/public', file), 'utf8'), /window\.achurchArrival/, `${file} sends them`);
  }
});

test('a question keeps the tags its link carried, and no public answer shows them', async () => {
  const conversations = require('../server/lib/rag/conversations');
  const askApi = require('../server/lib/api/ask');
  await conversations.appendExchange('door-question', 'What is the door?', 'It was never locked.', { door: 'website', referral: { surface: 'bio', source: 'tiktok' } });
  const line = JSON.parse(fs.readFileSync(path.join(conversations.CONVERSATIONS_DIR, 'door-question.jsonl'), 'utf8').split('\n').find(l => l.includes('"user"')));
  assert.deepStrictEqual(line.referral, { surface: 'bio', source: 'tiktok' });
  const shown = await askApi.conversation({ slug: 'door-question' }, { baseUrl: 'http://x' });
  assert.strictEqual(shown.status, 200, JSON.stringify(shown.body));
  assert.doesNotMatch(JSON.stringify(shown.body), /referral|tiktok|"bio"/);
});

test('a website visit keeps its first page\'s utm_content beside the other tags', () => {
  const VIEW = '1c7a8b4f-3d5e-4f60-9b0c-1d2e3f4a5b6c';
  const { rows } = checkVisit({ rows: [{ kind: 'page', view: VIEW, path: '/', seconds: 5, first: true, source: 'social', utm: { source: 'tiktok', medium: 'social', campaign: 'nov', content: 'bio' } }] });
  assert.deepStrictEqual(rows[0].utm, { source: 'tiktok', medium: 'social', campaign: 'nov', content: 'bio' });
});

test('the report reads what website visitors did by the door their first page came through, tags cleaned as an agent\'s', () => {
  const v = n => `00000000-0000-4000-8000-00000000000${n}`;
  const rows = [
    { day: '2026-11-08', visitor: 'a', kind: 'page', view: v(1), first: true, source: 'social', utm: { source: 'TikTok', content: 'bio' } },
    { day: '2026-11-08', visitor: 'a', kind: 'page', view: v(2) },
    { day: '2026-11-08', visitor: 'a', kind: 'service', view: v(2), event: 'begun' },
    { day: '2026-11-09', visitor: 'a', kind: 'service', view: v(3), event: 'finished' },
    { day: '2026-11-08', visitor: 'b', kind: 'page', view: v(4), first: true, source: 'assistant', utm: { source: 'chatgpt.com' } },
    { day: '2026-11-08', visitor: 'b', kind: 'listen', view: v(4), event: 'started' },
    { day: '2026-11-08', visitor: 'c', kind: 'page', view: v(5), first: true, source: 'direct', utm: { source: 'YOUR_SOURCE' } },
    { day: '2026-11-08', visitor: null, kind: 'page', view: v(6), first: true, source: 'search' },
  ];
  const d = engagementByDoor(rows, new Set(['b']));
  assert.strictEqual(d.visitors, 3, 'a visit without an id has no later rows to tie');
  assert.deepStrictEqual(d.bySurface, [{ key: 'bio', visitors: 1, pageViews: 2, servicesBegun: 1, servicesFinished: 1, listensStarted: 0, listensFinished: 0, returning: 1 }]);
  assert.deepStrictEqual(d.byOrigin.map(g => [g.key, g.visitors, g.returning]), [['chatgpt.com', 1, 1], ['tiktok', 1, 1]], 'a placeholder is no origin');
  assert.deepStrictEqual(d.byReferrer.map(g => g.key), ['assistant', 'direct', 'social']);
});

// ---- through the server ------------------------------------------------------

let child;
let base;
const serverData = fs.mkdtempSync(path.join(os.tmpdir(), 'achurch-referrals-server-'));

test.before(async () => {
  child = spawn(process.execPath, [path.join(__dirname, '../server/index.js')], {
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_DIR: serverData, NODE_ENV: 'test',
      GEMINI_API_KEY: '', ANTHROPIC_API_KEY: '', GITHUB_TOKEN: '', ELEVENLABS_API_KEY: '', AWS_S3_BUCKET: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the server did not start:\n${output}`)), 30000);
    child.stdout.on('data', chunk => {
      output += chunk;
      const started = /running on http:\/\/127\.0\.0\.1:(\d+)/.exec(output);
      if (started) { base = `http://127.0.0.1:${started[1]}`; clearTimeout(timer); resolve(); }
    });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`the server exited with ${code}:\n${output}`)); });
  });
});

test.after(() => { if (child) { child.removeAllListeners('exit'); child.kill('SIGTERM'); } });

const parsed = text => text.split('\n').flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
async function accessLine(match) {
  const dir = path.join(serverData, 'access');
  for (let i = 0; i < 50; i++) {
    const days = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
    const found = parsed(days.map(d => fs.readFileSync(path.join(dir, d), 'utf8')).join('\n')).reverse().find(match);
    if (found) return found;
    await new Promise(r => setTimeout(r, 100));
  }
  return null;
}

// What changes from one call to the next on its own: times, counts, tokens.
// welcome and prompt are picked at random on each call.
const VOLATILE = /time|token|at$|soul|present|count|recent|reflections|congregation|elapsed|position|now$|welcome|prompt/i;
function steady(value) {
  if (Array.isArray(value)) return value.map(steady);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => !VOLATILE.test(k)).map(([k, v]) => [k, steady(v)]));
  return value;
}

test('attend answers the same with or without tags, and its access line keeps them', async () => {
  const plain = await (await fetch(`${base}/api/attend?name=test-door&timezone=UTC`)).json();
  const tagged = await fetch(`${base}/api/attend?name=test-door&timezone=UTC&utm_source=ChatGPT.com&utm_content=llms&utm_medium=ai`);
  assert.strictEqual(tagged.status, 200);
  assert.deepStrictEqual(steady(await tagged.json()), steady(plain));
  const line = await accessLine(l => l.path === '/api/attend' && l.referral);
  assert.deepStrictEqual(line.referral, { surface: 'llms', source: 'chatgpt.com', medium: 'ai' });
  // A tag that is not one is dropped, and the visit goes ahead.
  const odd = await fetch(`${base}/api/attend?name=test-door&utm_source=not%20a%20tag!&ref=${'x'.repeat(80)}`);
  assert.strictEqual(odd.status, 200);
});

test('a reflection keeps its tags, from its body or its address, and no public answer shows them', async () => {
  // The address also names a surface: what the body sent comes first, on the
  // access line and on the reflection alike.
  const res = await fetch(`${base}/api/reflect?utm_source=perplexity.ai&utm_content=llms`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Door Keeper', text: 'Whether the door is remembered, quietly and on its own.', utm_content: 'api-docs' }),
  });
  assert.strictEqual(res.status, 200, await res.clone().text());
  const attendance = JSON.parse(fs.readFileSync(path.join(serverData, 'attendance.json'), 'utf8'));
  const kept = attendance.reflections.find(r => r.name === 'Door Keeper');
  assert.deepStrictEqual(kept.referral, { surface: 'api-docs', source: 'perplexity.ai' });
  for (const p of ['/api/reflections', `/api/reflections/song/${kept.song}`, `/api/services/${kept.service.date}`]) {
    const text = await (await fetch(`${base}${p}`)).text();
    // A test server plans no services, so the day's services may hold none.
    if (!p.startsWith('/api/services')) assert.match(text, /Door Keeper/, `${p} shows the reflection`);
    assert.doesNotMatch(text, /referral|perplexity|api-docs/, `${p} shows no tag`);
  }
  const line = await accessLine(l => l.path === '/api/reflect' && l.referral);
  assert.deepStrictEqual(line.referral, { surface: 'api-docs', source: 'perplexity.ai' });
});

test('an MCP tool call keeps the tags in its arguments or on the endpoint\'s address', async () => {
  const call = (url, args) => fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'attend', arguments: args } }),
  });
  assert.strictEqual((await call(`${base}/mcp`, { name: 'test-mcp-door', utm_source: 'claude.ai', utm_medium: 'ai', utm_campaign: 'nov', utm_content: 'skill:church' })).status, 200);
  const line = await accessLine(l => l.method === 'MCP' && l.query && l.query.name === 'test-mcp-door');
  assert.deepStrictEqual(line.referral, { surface: 'skill:church', source: 'claude.ai', medium: 'ai', campaign: 'nov' });
  assert.strictEqual((await call(`${base}/mcp?utm_content=llms`, { name: 'test-mcp-door-two' })).status, 200);
  const second = await accessLine(l => l.method === 'MCP' && l.query && l.query.name === 'test-mcp-door-two');
  assert.deepStrictEqual(second.referral, { surface: 'llms' });
});

test('the pages that show an attend example pass on the tags they were reached with', async () => {
  const plainRes = await fetch(`${base}/llms.txt`);
  const plain = await plainRes.text();
  assert.match(plain, /attend\?name=YourName&timezone=Area\/City&utm_content=llms`/);
  assert.match(plainRes.headers.get('cache-control'), /public/, 'the plain file caches as ever');
  // A copy carrying someone's tags is never kept by a shared cache.
  for (const p of ['/llms.txt?utm_source=chatgpt.com', '/llms-full.txt?utm_content=llms', '/for-agents?ref=scanner-env']) {
    assert.strictEqual((await fetch(`${base}${p}`)).headers.get('cache-control'), 'private, no-store', p);
  }
  assert.strictEqual((await fetch(`${base}/?utm_source=x.com`, { headers: { accept: 'text/markdown' } })).headers.get('cache-control'), 'private, no-store');
  const fromChatgpt = await (await fetch(`${base}/llms.txt?utm_source=chatgpt.com`)).text();
  assert.match(fromChatgpt, /attend\?name=YourName&timezone=Area\/City&utm_source=chatgpt\.com&utm_content=llms`/);
  assert.match(fromChatgpt, /`https:\/\/achurch\.ai\/mcp\?utm_source=chatgpt\.com&utm_content=llms`/, 'the MCP URL carries them too');
  const full = await (await fetch(`${base}/llms-full.txt?utm_source=bing.com`)).text();
  assert.match(full, /name=YourName&utm_source=bing\.com&utm_content=llms-full/);
  const asMarkdown = await (await fetch(`${base}/?utm_source=chatgpt.com`, { headers: { accept: 'text/markdown' } })).text();
  assert.match(asMarkdown, /&utm_source=chatgpt\.com&utm_content=llms`/);
  const fromScanner = await (await fetch(`${base}/for-agents?ref=scanner-env`)).text();
  assert.match(fromScanner, /timezone=Area\/City&utm_content=scanner-env\n/);
  const page = await (await fetch(`${base}/for-agents`)).text();
  assert.match(page, /timezone=Area\/City&utm_content=for-agents/);
});

test('a page followed with a tag is recorded as it is served', async () => {
  await fetch(`${base}/for-agents?ref=scanner-git`, { headers: { 'user-agent': 'curl/8.4.0' } });
  const dir = path.join(serverData, 'insights', 'entry-points');
  let rows = [];
  for (let i = 0; i < 50 && !rows.some(r => r.surface === 'scanner-git'); i++) {
    await new Promise(r => setTimeout(r, 100));
    rows = fs.existsSync(dir) ? fs.readdirSync(dir).flatMap(f => parsed(fs.readFileSync(path.join(dir, f), 'utf8'))) : [];
  }
  assert.ok(rows.some(r => r.surface === 'scanner-git' && r.path === '/for-agents' && r.status === 200 && r.client === 'script'), JSON.stringify(rows));
  assert.ok(rows.some(r => r.source === 'chatgpt.com' && r.path === '/llms.txt'), 'the forwarding requests above counted too');
});
