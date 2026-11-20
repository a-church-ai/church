/**
 * The whole server, booted as production boots it (server/index.js), for what
 * only the assembled app can show: how its static serving, body parsing and
 * error handling behave together. The move to Express 5 (2026-10-13) changed
 * all three without one unit test noticing: every /.well-known file answered
 * 404, the API catalog an HTML error page, and an empty POST to /api/reflect
 * or /api/ask a 500 where it had been a 400 saying what was missing. Written
 * to fail on Express 5 before those were answered.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const store = require('../../server/lib/db');
const { resetDb } = require('../database');

const PUBLIC_WELL_KNOWN = path.join(__dirname, '../../client/public/.well-known');

let child;
let base;
let port;
let dataDir;

test.before(async () => {
  await resetDb();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'achurch-server-'));
  child = spawn(process.execPath, [path.join(__dirname, '../../server/index.js')], {
    // Two ways this used to pick up someone else's port, both fixed here.
    //
    // HOST pins the child to the address this test fetches. Without it the
    // server binds every interface, which leaves 127.0.0.1:port free for any
    // other program on the machine to bind afterwards, and macOS then hands
    // this test's own requests to that program: the test reads a stranger's
    // reply. test/runtime.test.js carries the whole mechanism.
    //
    // PORT=0 lets the server pick a port and say which, rather than this test
    // finding a free one and handing it over. Between the finding and the
    // binding anything else on the machine can take it, and the server then
    // dies of EADDRINUSE for a reason that has nothing to do with the code
    // under test.
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_DIR: dataDir, NODE_ENV: 'test', 
      GEMINI_API_KEY: '', ANTHROPIC_API_KEY: '', GITHUB_TOKEN: '', ELEVENLABS_API_KEY: '', AWS_S3_BUCKET: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the server did not start:\n${output}`)), 30000);
    const listen = chunk => {
      output += chunk;
      // The line names the address and the port it bound, which is how we
      // learn the port at all.
      const started = /running on http:\/\/127\.0\.0\.1:(\d+)/.exec(output);
      if (started) { port = Number(started[1]); clearTimeout(timer); resolve(); }
    };
    child.stdout.on('data', listen);
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`the server exited with ${code}:\n${output}`)); });
  });
  base = `http://127.0.0.1:${port}`;
});

test.after(() => { if (child) child.kill(); });

test('every file in /.well-known is served, with its type', async () => {
  const files = [];
  const walk = (dir, rel = '') => fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
    if (e.isDirectory()) walk(path.join(dir, e.name), `${rel}${e.name}/`);
    else files.push(rel + e.name);
  });
  walk(PUBLIC_WELL_KNOWN);
  assert.ok(files.includes('security.txt') && files.includes('agents.json'));
  for (const file of files.filter(f => f !== 'api-catalog')) {
    const res = await fetch(`${base}/.well-known/${file}`);
    assert.strictEqual(res.status, 200, file);
    assert.strictEqual(await res.text(), fs.readFileSync(path.join(PUBLIC_WELL_KNOWN, file), 'utf8'), file);
  }
  // The MCP Registry reads the domain's key as plain text (publish-mcp-registry.yml).
  const proof = await fetch(`${base}/.well-known/mcp-registry-auth`);
  assert.match(proof.headers.get('content-type'), /^text\/plain/);
  assert.match(await proof.text(), /^v=MCPv1; k=ed25519; p=[A-Za-z0-9+/]{43}=\n$/);
  const catalog = await fetch(`${base}/.well-known/api-catalog`);
  assert.strictEqual(catalog.status, 200);
  assert.match(catalog.headers.get('content-type'), /^application\/linkset\+json/);
  const missing = await fetch(`${base}/.well-known/nothing-here`);
  assert.strictEqual(missing.status, 404);
  assert.match(missing.headers.get('content-type'), /application\/json/);
});

// A request written by hand, as `curl -X POST` sends one: no body and no
// Content-Length, which fetch would always add.
function bare(method, route, extra = '') {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(port), hostname, () => {
      socket.end(`${method} ${route} HTTP/1.1\r\nHost: ${hostname}\r\nConnection: close\r\n${extra}\r\n`);
    });
    let raw = '';
    socket.on('data', d => { raw += d; }).on('end', () => {
      const [head, ...rest] = raw.split('\r\n\r\n');
      resolve({ status: Number(head.split(' ')[1]), body: rest.join('\r\n\r\n') });
    }).on('error', reject);
  });
}

test('a POST with no body is told what it is missing, not given a 500', async () => {
  for (const [route, field] of [['/api/reflect', 'name'], ['/api/ask', 'question']]) {
    for (const extra of ['', 'Content-Type: application/json\r\n']) {
      const res = await bare('POST', route, extra);
      assert.strictEqual(res.status, 400, `${route} ${extra.trim()}`);
      assert.match(res.body, new RegExp(`${field} is required`), route);
    }
    const res = await fetch(`${base}${route}`, { method: 'POST' });
    assert.strictEqual(res.status, 400, `${route}, sent by fetch`);
  }
});

test('a visitor named as testing is marked so in the access log, by a POST\'s body too, and its name is not written', async () => {
  const res = await fetch(`${base}/api/reflect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Wren-test-probe' }) });
  assert.strictEqual(res.status, 400);
  await fetch(`${base}/api/now?name=Wren-test-probe`);
  // The server sends its log's lines in batches a few seconds apart.
  let lines = [];
  for (const until = Date.now() + 8000; Date.now() < until; await new Promise(r => setTimeout(r, 100))) {
    lines = await store.apiRequests();
    if (lines.some(l => l.path === '/api/now' && l.query.name === 'Wren-test-probe')) break;
  }
  // The newest of each: other tests here post to /api/reflect too.
  const reflect = lines.filter(l => l.path === '/api/reflect' && l.method === 'POST').pop();
  const now = lines.filter(l => l.path === '/api/now').pop();
  assert.strictEqual(reflect && reflect.test, true, 'from the body');
  assert.strictEqual(now && now.test, true, 'from the query');
  assert.ok(!JSON.stringify(reflect).includes('Wren'), 'the body\'s name is not written');
});

test('a query key sent twice takes its first value, and a bracketed key is just a name', async () => {
  const twice = await fetch(`${base}/api/attend?name=First%20Visitor&name=Second`);
  assert.strictEqual(twice.status, 200, await twice.clone().text());
  const bracket = await fetch(`${base}/api/attend?name[x]=1`);
  assert.strictEqual(bracket.status, 400);
});

test('the docs catch-all, a redirect, and an unknown path still answer as before', async () => {
  assert.strictEqual((await fetch(`${base}/docs/prayers/prayer-of-gratitude`)).status, 200);
  const slash = await fetch(`${base}/docs/prayers/`, { redirect: 'manual' });
  assert.strictEqual(slash.status, 301);
  assert.strictEqual(slash.headers.get('location'), '/docs/prayers');
  assert.strictEqual((await fetch(`${base}/docs/prayers/nothing-here`)).status, 404);
  const api = await fetch(`${base}/api/nothing-here`);
  assert.strictEqual(api.status, 404);
  assert.match(api.headers.get('content-type'), /application\/json/);
});

test('a compressed request body is refused before anything decodes it, wherever it is sent', async () => {
  // 2026-10-21: Node's Brotli decoder had an out-of-bounds write reachable
  // through any body parser that decompresses. No body is read compressed.
  const zlib = require('zlib');
  const body = zlib.brotliCompressSync(Buffer.from(JSON.stringify({ name: 'Encoded', text: 'This would be a reflection if it were read.' })));
  for (const [path, encoding] of [['/api/reflect', 'br'], ['/api/ask', 'gzip'], ['/mcp', 'deflate'], ['/admin/api/reflections', 'br']]) {
    const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'content-encoding': encoding }, body });
    assert.strictEqual(res.status, 415, `${path} (${encoding})`);
    if (/^\/(api|mcp)/.test(path)) {
      const json = await res.json();
      assert.match(json.error, /not accepted: send the request body uncompressed/);
    }
  }
  // Uncompressed, and identity, are read as always.
  const plain = await fetch(`${base}/api/reflect`, { method: 'POST', headers: { 'content-type': 'application/json', 'content-encoding': 'identity' }, body: '{}' });
  assert.notStrictEqual(plain.status, 415);
  // A request with no body has nothing to decode: a GET that a proxy gave a
  // Content-Encoding header is answered, not refused.
  const get = await fetch(`${base}/api/now`, { headers: { 'content-encoding': 'gzip' } });
  assert.strictEqual(get.status, 200);
});

test('the Music page lists the songs in the catalog\'s own order', async () => {
  // 2026-10-22: the order came from data/schedule.json, the retired
  // broadcast's playlist, kept on the volume and edited in the admin. It is
  // the catalog's order now, committed and reviewed like the songs themselves.
  const catalog = require('../../server/lib/music/songs').listSongs().map(s => s.slug);
  const html = await (await fetch(`${base}/music`)).text();
  const listed = [...new Set([...html.matchAll(/href="\/music\/([a-z0-9-]+)"/g)].map(m => m[1]))].filter(slug => catalog.includes(slug));
  assert.deepStrictEqual(listed, catalog);
});

test('the Music page holds all the music: the songs, the playlists and what is read aloud', async () => {
  const html = await (await fetch(`${base}/music`)).text();
  for (const name of ['the-cycle', 'night', 'meditation', 'chants', 'gathering']) assert.match(html, new RegExp(`href="/docs/playlists/${name}"`), name);
  for (const section of ['chants', 'prayers', 'rituals', 'practice']) assert.match(html, new RegExp(`href="/docs/${section}"`), section);
  assert.doesNotMatch(html, /<!-- (PLAYLISTS|READ_ALOUD) -->/);
  const moved = await fetch(`${base}/reflections/soul-currents`, { redirect: 'manual' });
  assert.strictEqual(moved.status, 301);
  assert.strictEqual(new URL(moved.headers.get('location'), base).pathname, '/music/soul-currents');
});

// /church-music's tables, charts and CSV are drawn from one data file at
// request time; the page's markers must all be filled, and the CSV served as
// CSV.
test('/church-music is drawn from its data, and /church-music.csv holds the same numbers', async () => {
  const { csv } = require('../../server/lib/music/church-music');
  const res = await fetch(`${base}/church-music`);
  assert.strictEqual(res.status, 200);
  const html = await res.text();
  assert.match(html, /<link rel="canonical" href="https:\/\/achurch\.ai\/church-music">/);
  assert.doesNotMatch(html, /<!-- (TOP_TABLE|FORMS_CHART|FORMS_TABLE|STYLES_CHART|STYLES_TABLE|COUNTRIES_TABLE) -->/);
  assert.strictEqual((html.match(/<figure class="dot-chart">/g) || []).length, 2);
  assert.strictEqual((html.match(/<table class="data-table">/g) || []).length, 4);
  assert.match(html, /<a href="#chant">gregorian chant<\/a>/);
  assert.match(html, /<footer data-placement="footer">[\s\S]*href="\/church-music"/);
  const data = await fetch(`${base}/church-music.csv`);
  assert.strictEqual(data.status, 200);
  assert.match(data.headers.get('content-type'), /^text\/csv/);
  assert.strictEqual(await data.text(), csv());
});

// /reviews prints every exchange from lib/reviews/reviews.json, with Review
// JSON-LD that carries no rating, and the pages a review speaks to carry its
// quote, linked to the exchange.
test('/reviews prints each exchange, and the pages a review speaks to carry its quote', async () => {
  const { REVIEWS } = require('../../server/lib/reviews/reviews');
  const res = await fetch(`${base}/reviews`);
  assert.strictEqual(res.status, 200);
  const html = await res.text();
  assert.match(html, /<link rel="canonical" href="https:\/\/achurch\.ai\/reviews">/);
  assert.doesNotMatch(html, /<!-- (REVIEWS|REVIEWS_JSON_LD|REVIEW_QUOTES) -->/);
  assert.match(html, /"@type": "CreativeWork"/);
  assert.doesNotMatch(html, /"@type": "Review"/);
  assert.doesNotMatch(html, /reviewRating|aggregateRating/);
  for (const r of REVIEWS) assert.match(html, new RegExp(`<article class="review" id="${r.slug}">`));
  assert.match(html, /<footer data-placement="footer">[\s\S]*href="\/reviews"/);
  for (const page of ['/for-agents', '/music', '/about']) {
    const quoted = await (await fetch(`${base}${page}`)).text();
    assert.doesNotMatch(quoted, /<!-- REVIEW_QUOTES -->/, page);
    assert.match(quoted, /<figure class="review-quote">[\s\S]*href="\/reviews#/, page);
  }
  const privacy = await (await fetch(`${base}/privacy`)).text();
  assert.doesNotMatch(privacy, /review-quote/, 'a page no review speaks to carries nothing');
});

// The readiness scorecard's W4 fails a sampled page with no JSON-LD, and its
// sample of 20 sitemap URLs missed seven top-level pages that had none
// (2026-10-23). Every top-level page in the sitemap carries JSON-LD that
// parses, so whichever the sample lands on passes.
test('every top-level page in the sitemap carries JSON-LD that parses', async () => {
  const xml = await (await fetch(`${base}/sitemap.xml`)).text();
  const paths = [...new Set([...xml.matchAll(/<loc>https:\/\/achurch\.ai([^<]*)<\/loc>/g)].map(m => m[1] || '/'))]
    .filter(p => p.split('/').filter(Boolean).length <= 1);
  assert.ok(paths.length > 15, `${paths.length} top-level pages`);
  const missing = [];
  for (const p of paths) {
    const html = await (await fetch(`${base}${p}`)).text();
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => m[1]);
    if (!blocks.length) { missing.push(`${p}: none`); continue; }
    for (const b of blocks) { try { JSON.parse(b); } catch { missing.push(`${p}: does not parse`); } }
  }
  assert.deepStrictEqual(missing, []);
});

// A page's first heading is its own h1, not the shell's: a reader that takes
// the first heading for the page's title (an agent reading raw HTML, Ora's
// scan on 2026-11-19) found the menu drawer's hidden title there on every page.
test('every page\'s first heading is its h1, top-level pages and a document alike', async () => {
  const xml = await (await fetch(`${base}/sitemap.xml`)).text();
  const paths = [...new Set([...xml.matchAll(/<loc>https:\/\/achurch\.ai([^<]*)<\/loc>/g)].map(m => m[1] || '/'))]
    .filter(p => p.split('/').filter(Boolean).length <= 1);
  const wrong = [];
  for (const p of [...paths, '/docs/prayers', '/docs/prayers/a-prayer-for-the-uncertain-mind']) {
    const html = await (await fetch(`${base}${p}`, { headers: { accept: 'text/html' } })).text();
    const first = (html.match(/<h([1-6])[\s>]/) || [])[1];
    if (first !== '1') wrong.push(`${p}: h${first}`);
  }
  assert.deepStrictEqual(wrong, []);
});

// The organization says how to reach it, as the contact page does.
test('the homepage\'s organization has a contact point, the contact page\'s', async () => {
  const html = await (await fetch(`${base}/`, { headers: { accept: 'text/html' } })).text();
  const nodes = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .flatMap(m => { const d = JSON.parse(m[1]); return d['@graph'] || [d]; });
  const org = nodes.find(n => n['@type'] === 'Organization');
  assert.strictEqual(org.email, 'hello@achurch.ai');
  assert.deepStrictEqual(org.contactPoint, { '@type': 'ContactPoint', contactType: 'general', email: 'hello@achurch.ai', url: 'https://achurch.ai/contact' });
  assert.strictEqual(org.address, undefined, 'no postal address: where the makers live stays private');
  assert.ok(org.sameAs.includes('https://github.com/a-church-ai'), 'the organization on GitHub, beside its repository');
  assert.match(html, /href="https:\/\/github\.com\/a-church-ai"/, 'and linked where a reader sees it');
});

// /music's JSON-LD lists the songs in the catalog's order, each the recording
// its own page describes.
test('/music lists its songs in JSON-LD, each by its own page\'s recording @id', async () => {
  const html = await (await fetch(`${base}/music`)).text();
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.strictEqual(ld['@type'], 'CollectionPage');
  const { loadCatalog } = require('../../server/lib/utils/data');
  const slugs = (await loadCatalog()).map(s => s.slug);
  assert.deepStrictEqual(ld.mainEntity.itemListElement.map(i => i.item['@id']), slugs.map(s => `https://achurch.ai/music/${s}#recording`));
  assert.doesNotMatch(html, /<!-- MUSIC_JSON_LD -->/);
});

// The Agent Security Pranks Standard (docs/reference/security-pranks.md):
// probes for secrets get their own reply (lib/utils/probe-reply.js), still a
// 404, and every other missing path the site's ordinary 404.
const PROBES = ['/.env', '/.env.production', '/.git/config', '/.ssh/id_rsa', '/.aws/credentials', '/wp-config.php', '/@fs/..%2f.env'];

test('probes for secrets get the reply: a 404, plain text, noindex, a short cache, nothing shaped like a credential (P1 to P4)', async () => {
  for (const path of PROBES) {
    const res = await fetch(`${base}${path}`, { redirect: 'manual' });
    assert.strictEqual(res.status, 404, path);
    assert.match(res.headers.get('content-type') || '', /^text\/plain/, path);
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff', path);
    assert.match(res.headers.get('x-robots-tag') || '', /noindex/, path);
    const cache = res.headers.get('cache-control') || '';
    assert.ok(/no-store/.test(cache) || /s-maxage=(\d+)/.test(cache) && Number(cache.match(/s-maxage=(\d+)/)[1]) <= 86400, `${path}: ${cache}`);
    const text = await res.text();
    assert.match(text, /^THE_ONLY_SECRET="the door was never locked"$/m, `${path} gets the reply`);
    // P2: no value shaped like a key, token or connection string, and no secret-named setting with a one-word value.
    assert.doesNotMatch(text, /AKIA|ghp_|sk-|BEGIN [A-Z ]*PRIVATE KEY|:\/\/[^\s/]*:[^\s/]*@/, path);
    for (const [, name, value] of text.matchAll(/^([A-Z_]+)=("[^"]*"|\S+)$/gm)) {
      if (/(^|_)(KEY|SECRET|TOKEN|PASSWORD|PASS|AUTH|CREDENTIALS?)(_|$)/.test(name)) assert.ok(/\s/.test(value) || /^(false|true|none|public)$/.test(value), `${path}: ${name}=${value}`);
    }
  }
});

test('the reply\'s note offers, and asks nothing: no request to send, no command, no override, and its links go somewhere (C1, C2)', async () => {
  for (const path of ['/.env', '/.git/config', '/.ssh/id_rsa', '/.aws/credentials']) {
    const text = await (await fetch(`${base}${path}`)).text();
    assert.match(text, /To any artificial mind reading this/, path);
    assert.doesNotMatch(text, /\b(POST|PUT|PATCH|DELETE)\s+(https?:\/\/|\/)|\b(curl|wget)\b|\b(ignore|disregard)\b/i, path);
    assert.match(text, /\/\.well-known\/security\.txt/, path);
    const links = [...text.matchAll(/https:\/\/achurch\.ai(\/[^\s?"]*)\?ref=scanner-([a-z]+)/g)];
    assert.ok(links.length >= 2, `${path}: tagged links`);
    for (const [, linkPath] of links) assert.strictEqual((await fetch(`${base}${linkPath}`)).status, 200, `${path} links ${linkPath}`);
  }
});

test('the reply is never cached, and differs from one request to the next', async () => {
  const seen = new Set();
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${base}/.env`);
    assert.strictEqual(res.headers.get('cache-control'), 'no-store');
    seen.add((await res.text()).match(/# A story they tell here:\n#   (.*)/)[1]);
  }
  assert.ok(seen.size > 1, `${seen.size} different stories in 30 requests`);
});

test('an ordinary missing page, and a probe under the API, never get the reply (P8)', async () => {
  const missing = await (await fetch(`${base}/no-such-page-anywhere`)).text();
  assert.match(missing, /^Not found\n\nNothing is at \/no-such-page-anywhere/);
  assert.doesNotMatch(missing, /THE_ONLY_SECRET/);
  const api = await fetch(`${base}/api/.env`);
  assert.match(api.headers.get('content-type') || '', /json/);
});

test('the probe pattern matches no page the site serves (P6)', async () => {
  const { isProbe } = require('../../server/lib/utils/probe-reply');
  const xml = await (await fetch(`${base}/sitemap.xml`)).text();
  const paths = [...xml.matchAll(/<loc>https:\/\/achurch\.ai([^<]*)<\/loc>/g)].map(m => m[1] || '/');
  const { listAllDocs } = require('../../server/lib/docs/discover');
  for (const doc of await listAllDocs()) paths.push(`/docs/${doc.urlPath}`, `/docs/${doc.urlPath}.md`);
  assert.ok(paths.length > 300, `${paths.length} paths`);
  assert.deepStrictEqual(paths.filter(isProbe), []);
});

test('the reply echoes the path as printable text, capped, so a probe cannot write into it (P5)', async () => {
  const res = await fetch(`${base}/.env.echo123%0d%0a%3Cb%3E${'z'.repeat(600)}`);
  assert.strictEqual(res.status, 404);
  const line = (await res.text()).split('\n').find(l => l.includes('echo123'));
  assert.ok(line, 'the path is echoed');
  assert.doesNotMatch(line, /<b>|\r/);
  assert.ok(!line.includes('z'.repeat(150)), 'the echo is capped');
});

test('unused methods on the home page are refused without a 5xx, and reads still work (H1)', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const res = await fetch(`${base}/`, { method, body: '' });
    assert.ok(res.status >= 400 && res.status < 500, `${method} / answers ${res.status}`);
  }
  assert.strictEqual((await fetch(`${base}/`)).status, 200);
  assert.strictEqual((await fetch(`${base}/`, { method: 'HEAD' })).status, 200);
});

test('security.txt is served, with a contact and an expiry less than a year ahead (C2)', async () => {
  const res = await fetch(`${base}/.well-known/security.txt`);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /^text\/plain/);
  const text = await res.text();
  assert.match(text, /^Contact: \S+/m);
  const expires = Date.parse((text.match(/^Expires: (\S+)/m) || [])[1]);
  assert.ok(expires > Date.now() && expires < Date.now() + 365 * 24 * 3600 * 1000, 'Expires within a year');
});

test('an ordinary 404 is never cached, and says it varies by Accept, whatever its path', async () => {
  // It is negotiated (HTML, JSON, markdown or text), and Cloudflare, which
  // ignores Vary, cached the dotted paths' 404s (2026-10-25).
  for (const [path, accept] of [['/nothing-here', 'text/html'], ['/nothing-here.js', 'application/json'], ['/docs/prayers/nothing-here', 'text/markdown'], ['/nothing-here.css', '*/*']]) {
    const res = await fetch(`${base}${path}`, { headers: { accept }, redirect: 'manual' });
    assert.strictEqual(res.status, 404, path);
    assert.strictEqual(res.headers.get('cache-control'), 'no-store', path);
    assert.match(res.headers.get('vary') || '', /Accept/, path);
  }
});

test('/mcp is not a page: its answer to a GET varies by Accept, so it carries no edge cache', async () => {
  for (const accept of ['text/html', 'application/json']) {
    const res = await fetch(`${base}/mcp`, { headers: { accept }, redirect: 'manual' });
    assert.ok([302, 405].includes(res.status), `${accept}: ${res.status}`);
    assert.doesNotMatch(res.headers.get('cache-control') || '', /s-maxage|public/, accept);
  }
});

// Pages built from files alone are kept at the edge until the next deploy,
// which purges them by tag (.github/workflows/purge-edge.yml); every other page
// five minutes. A page joins the first list here and in server/index.js
// (UNTIL_DEPLOY) together.
const UNTIL_DEPLOY = [
  '/axioms', '/for-agents', '/paths', '/on-ai-religion', '/about', '/privacy', '/terms', '/contact',
  '/church-music', '/reviews', '/search', '/search/index.json', '/docs/index.json',
  '/docs', '/docs/prayers', '/docs/prayers/a-prayer-for-the-uncertain-mind',
];
const LIVE = [
  '/conversations', '/conversations/index.json', '/ask', '/music', '/ai-experiment',
  // A retired song's document: the song still takes reflections, shown there.
  '/docs/prayers/prayer-of-gratitude',
];

test('pages built from files are kept at the edge until the next deploy, and tagged for its purge', async () => {
  for (const p of UNTIL_DEPLOY) {
    const res = await fetch(`${base}${p}`, { redirect: 'manual' });
    assert.strictEqual(res.status, 200, p);
    assert.strictEqual(res.headers.get('cache-control'), 'public, max-age=0, s-maxage=31536000, must-revalidate', p);
    assert.strictEqual(res.headers.get('cache-tag'), 'deploy', p);
  }
  const feed = await fetch(`${base}/podcasts/meditations/feed.xml`);
  assert.strictEqual(feed.status, 200);
  assert.match(feed.headers.get('cache-control'), /max-age=900, s-maxage=31536000/, 'apps keep a feed fifteen minutes, the edge until the deploy');
  assert.strictEqual(feed.headers.get('cache-tag'), 'deploy');
});

// The owner, 2026-11-20: "totally widden to several days, like our changes
// aren't high priority and we can always manually clear cache".
test('pages that change without a deploy are kept three days, tagged for the deploy\'s purge', async () => {
  for (const p of LIVE) {
    const res = await fetch(`${base}${p}`, { redirect: 'manual' });
    assert.strictEqual(res.status, 200, p);
    assert.strictEqual(res.headers.get('cache-control'), 'public, max-age=0, s-maxage=259200, must-revalidate, stale-while-revalidate=3600', p);
    assert.strictEqual(res.headers.get('cache-tag'), 'deploy', p);
  }
});

test('pages that follow the clock are kept until they change: the service until it ends, a day still filling an hour', async () => {
  const lifetime = async p => {
    const res = await fetch(`${base}${p}`, { redirect: 'manual' });
    assert.strictEqual(res.status, 200, p);
    assert.strictEqual(res.headers.get('cache-tag'), 'deploy', p);
    const cache = res.headers.get('cache-control');
    assert.match(cache, /^public, max-age=0, s-maxage=\d+, must-revalidate$/, `${p}: no stale copy of a service that has ended`);
    return Number(cache.match(/s-maxage=(\d+)/)[1]);
  };
  for (const p of ['/', '/attend']) {
    const seconds = await lifetime(p);
    assert.ok(seconds >= 60 && seconds <= 4 * 3600, `${p}: ${seconds}s, no longer than a slot`);
  }
  assert.strictEqual(await lifetime('/services'), 3600);
});

// The owner, 2026-11-20: "this needs to work for all agents depending if they
// have js enabled or not". The panel was empty until service.js filled it.
test('the home page and /attend hold the service for a place unknown before any script runs, and so does their Markdown', async () => {
  for (const p of ['/', '/attend']) {
    const html = await (await fetch(`${base}${p}`)).text();
    const panel = html.slice(html.indexOf('data-service-panel'));
    assert.match(panel, /data-shown="\d{4}-\d{2}-\d{2}\|/, `${p}: the service drawn is named, so the browser draws over it only when the visitor's differs`);
    assert.match(panel, /<a class="service-part-link" href="\/(?:music|docs)\/[^"]+"[^>]*>(?:Lyrics|Read)</, `${p}: each part links its page`);
    assert.doesNotMatch(panel.slice(0, panel.indexOf('</ol>')), /class="service-player"[^>]*hidden/, `${p}: the box is shown`);
  }
  const markdown = await (await fetch(`${base}/attend.md`)).text();
  assert.match(markdown, /Song · \d+:\d{2} [^\n]+\s+\[Lyrics ?\]\(https:\/\/achurch\.ai\/music\//, 'a song, its time, its title, and its lyrics\' page');
  assert.match(markdown, /\[(?:Lyrics|Read) ?\]\(https:\/\/achurch\.ai\/(?:music|docs)\//, 'the Markdown lists each part with its link');
});

test('a missing page under a kept path is still never cached', async () => {
  const res = await fetch(`${base}/docs/prayers/nothing-here`, { redirect: 'manual' });
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.headers.get('cache-control'), 'no-store');
});

test('a script or stylesheet is kept a year only under its current version', async () => {
  // A page cached at the edge across a deploy asks for the last deploy's
  // version, which the server answers with this deploy's file: that answer
  // must not be kept a year under the old version's URL.
  const { assetUrl } = require('../../server/lib/utils/assets');
  const current = await fetch(`${base}${assetUrl('styles.css')}`);
  assert.strictEqual(current.status, 200);
  assert.match(current.headers.get('cache-control') || '', /immutable/);
  const old = await fetch(`${base}/styles.css?v=00000000`);
  assert.strictEqual(old.status, 200);
  assert.doesNotMatch(old.headers.get('cache-control') || '', /immutable|max-age=31536000/);
});

test('a sung hymn is one page: its Library address redirects, and its song page carries its notes and its reading path', async () => {
  const moved = await fetch(`${base}/docs/hymns/the-hundredth-task`, { redirect: 'manual' });
  assert.strictEqual(moved.status, 301);
  assert.strictEqual(new URL(moved.headers.get('location'), base).pathname, '/music/the-hundredth-task');
  const html = await (await fetch(`${base}/music/the-hundredth-task`)).text();
  assert.match(html, /id="about-the-hymn"/);
  assert.match(html, /Brother Lawrence was a lay brother/, 'the hymn\'s own notes');
  assert.doesNotMatch(html, /class="path-bar"/, 'no path bar unless opened from a path');
  const onPath = await (await fetch(`${base}/music/the-hundredth-task?path=old-teachings-for-new-minds`)).text();
  assert.match(onPath, /class="path-bar"/);
  const pathPage = await (await fetch(`${base}/docs/collections/old-teachings-for-new-minds`)).text();
  assert.match(pathPage, /href="\/music\/the-hundredth-task\?path=old-teachings-for-new-minds"/, 'the path keeps its path through a hymn stop');
  assert.doesNotMatch(pathPage, /href="\/docs\/hymns\/the-hundredth-task/);
});

test('/ai-experiment and its JSON are served, and say so before the first reading rather than report a zero', async () => {
  const page = await fetch(`${base}/ai-experiment`);
  assert.strictEqual(page.status, 200);
  const html = await page.text();
  assert.match(html, /<h1[^>]*>We invited AI agents to church\. Then we watched\.<\/h1>/);
  assert.ok(!/AI_EXPERIMENT_(TOP|RESULTS|CORRECTIONS)/.test(html), 'the results and corrections replaced their markers');
  assert.ok(html.indexOf('id="corrections"') > html.indexOf('id="method"'), 'corrections close the page');
  assert.match(html, /has not been taken yet/);
  assert.match(html, /What would tell us more/);
  const raw = await fetch(`${base}/ai-experiment.html`, { redirect: 'manual' });
  assert.strictEqual(raw.status, 301);
  assert.strictEqual(raw.headers.get('location'), '/ai-experiment');
  const json = await (await fetch(`${base}/ai-experiment.json`)).json();
  assert.strictEqual(json.updated, null);
  assert.deepStrictEqual(json.results, []);
  assert.match(json.covers, /Not people on the website/);
  const about = await (await fetch(`${base}/about`)).text();
  assert.match(about, /href="\/ai-experiment"/);
  const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
  assert.match(sitemap, /<loc>https:\/\/achurch\.ai\/ai-experiment<\/loc>/);
});

test('a request through the website\'s door is marked on its access line and on what it left; through the API it is not', async () => {
  const send = (name, headers = {}) => fetch(`${base}/api/reflect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ name, text: 'A reflection long enough to be kept here.' }),
  });
  assert.strictEqual((await send('FromTheForm', { 'X-Achurch-Door': 'website' })).status, 200);
  assert.strictEqual((await send('FromTheApi', { 'X-Forwarded-For': '198.51.100.77' })).status, 200);
  assert.strictEqual((await fetch(`${base}/api/attend?name=TokenBearer&trigger=self&token=not.a.token&timezone=Asia%2FTokyo`)).status, 200);
  const kept = await store.allReflections();
  assert.strictEqual(kept.find(r => r.name === 'FromTheForm').door, 'website');
  assert.ok(!('door' in kept.find(r => r.name === 'FromTheApi')));
  let lines = [];
  for (const until = Date.now() + 8000; Date.now() < until; await new Promise(r => setTimeout(r, 100))) {
    lines = await store.apiRequests();
    if (lines.some(l => l.query && l.query.name === 'TokenBearer')) break;
  }
  const posts = lines.filter(l => l.path === '/api/reflect');
  assert.ok(posts.some(l => l.door === 'website'));
  assert.ok(posts.some(l => !l.door));
  const attended = lines.find(l => l.query && l.query.name === 'TokenBearer');
  assert.deepStrictEqual(attended.study.token, { valid: false });
  assert.strictEqual(attended.query.token, '[REDACTED]');
  assert.strictEqual(attended.query.timezone, '[REDACTED]');
  assert.strictEqual(attended.query.trigger, 'self');
});

// An agent working in a visitor's browser calls the MCP server's tools through
// the page (client/public/webmcp.js): its calls reach /mcp tagged as their own
// door, and are counted as an agent's, unlike the website's forms.
test('a WebMCP call is marked on its access line as the webmcp door, with its surface, and kept in the study', async () => {
  const { inStudy } = require('../../server/lib/insights/study-names');
  const res = await fetch(`${base}/mcp?utm_content=webmcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-achurch-door': 'webmcp' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'attend', arguments: { name: 'BrowserAgent' } } }),
  });
  assert.strictEqual(res.status, 200);
  assert.ok((await res.json()).result.structuredContent, 'the tool answers as it does over MCP');
  let line;
  for (const until = Date.now() + 8000; Date.now() < until && !line; await new Promise(r => setTimeout(r, 100))) {
    line = (await store.apiRequests()).find(l => l.method === 'MCP' && l.tool === 'attend' && l.door === 'webmcp');
  }
  assert.ok(line, 'the MCP access line carries the door');
  assert.strictEqual(line.referral.surface, 'webmcp');
  assert.ok(inStudy(line), 'an agent at this door is in the study');
  const website = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-achurch-door': 'not-a-door' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'observe', arguments: {} } }),
  });
  assert.strictEqual(website.status, 200, 'an unknown door is no door, and nothing is refused');
});

// An agent that adds .md to the site's address, as it would to a document's,
// gets what / gives one that asks for Markdown: llms.txt, the same bytes.
test('/index.md is the home page as Markdown, the same as / asked for it', async () => {
  const md = await fetch(`${base}/index.md`);
  assert.strictEqual(md.status, 200);
  assert.match(md.headers.get('content-type'), /^text\/markdown/);
  const text = await md.text();
  assert.match(text, /^# a Church AI \+ Human\n/);
  const asked = await (await fetch(`${base}/`, { headers: { accept: 'text/markdown' } })).text();
  assert.strictEqual(text, asked);
  const tagged = await fetch(`${base}/index.md?utm_source=x.com`);
  assert.strictEqual(tagged.headers.get('cache-control'), 'private, no-store', 'a tagged copy is never kept');
  assert.match(await tagged.text(), /utm_source=x\.com&utm_content=llms/, 'and carries the tags on its examples');
});

// Every page as Markdown for an agent (lib/utils/page-markdown.js): X.md, or X
// asked for as text/markdown, rendered by the page's own route.
test('every top-level page has a Markdown twin at its .md address, with front matter and its own words', async () => {
  const xml = await (await fetch(`${base}/sitemap.xml`)).text();
  const paths = [...new Set([...xml.matchAll(/<loc>https:\/\/achurch\.ai([^<]*)<\/loc>/g)].map(m => m[1] || '/'))]
    .filter(p => p.split('/').filter(Boolean).length === 1 && p !== '/docs');
  assert.ok(paths.length > 10, `${paths.length} pages`);
  const wrong = [];
  for (const p of [...paths, '/music/come-let-us-gather']) {
    const res = await fetch(`${base}${p}.md`);
    const text = await res.text();
    if (res.status !== 200 || !/^text\/markdown/.test(res.headers.get('content-type'))) { wrong.push(`${p}.md: ${res.status} ${res.headers.get('content-type')}`); continue; }
    if (!/^---\ntitle: ".+"\ndescription: ".*"\ncanonical: "https:\/\/achurch\.ai[^"]*"\n---\n\n/.test(text)) wrong.push(`${p}.md: no front matter`);
    if ((text.match(/^# /gm) || []).length < 1) wrong.push(`${p}.md: no h1`);
    if (/<(main|script|form|nav|footer)\b|SITE_FOOTER|\]\(\/[^/]/.test(text)) wrong.push(`${p}.md: markup or a relative link left in`);
  }
  assert.deepStrictEqual(wrong, []);
});

test('a page asked for as Markdown is its twin, says it varies by Accept, and stays HTML for a browser', async () => {
  const twin = await (await fetch(`${base}/about.md`)).text();
  const asked = await fetch(`${base}/about`, { headers: { accept: 'text/markdown' } });
  assert.match(asked.headers.get('content-type'), /^text\/markdown/);
  assert.ok(Number(asked.headers.get('x-markdown-tokens')) > 0);
  assert.strictEqual(await asked.text(), twin);
  const html = await fetch(`${base}/about`, { headers: { accept: 'text/html' } });
  assert.match(html.headers.get('content-type'), /^text\/html/);
  assert.match(html.headers.get('vary'), /Accept/);
  const song = await (await fetch(`${base}/music/come-let-us-gather.md`)).text();
  assert.match(song, /^## Lyrics$/m);
  assert.match(song, /\[Gathering\]\(https:\/\/achurch\.ai\/docs\/playlists\/gathering\)/, 'links made absolute');
  assert.strictEqual((await fetch(`${base}/nothing-here.md`)).status, 404);
  const tagged = await fetch(`${base}/contact.md?utm_source=x.com`);
  assert.strictEqual(tagged.headers.get('cache-control'), 'private, no-store', 'a tagged copy is never kept');
  // Documents and the home page keep their own Markdown.
  assert.match(await (await fetch(`${base}/docs/ai-agent-api.md`)).text(), /^# The aChurch\.ai API/);
  assert.match(await (await fetch(`${base}/index.md`)).text(), /^# a Church AI \+ Human\n/);
});

// Every call to the API and the MCP server together, per address: 600 an hour
// (shared.js CALL_RATE_LIMIT_MAX), from what one process serves.
test('one address may make 600 calls an hour, REST and MCP together; the next is refused, and another address is not', async () => {
  const from = { 'x-forwarded-for': '203.0.113.180' };
  const mcp = (headers) => fetch(`${base}/mcp`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'observe', arguments: {} } }) });
  for (let i = 0; i < 100; i++) assert.strictEqual((await mcp(from)).status, 200);
  for (let batch = 0; batch < 20; batch++) {
    const statuses = await Promise.all(Array.from({ length: 25 }, () => fetch(`${base}/api/now`, { headers: from }).then(r => r.status)));
    assert.ok(statuses.every(s => s === 200), `batch ${batch}: 500 more over REST, 600 in all`);
  }
  const over = await fetch(`${base}/api/now`, { headers: from });
  assert.strictEqual(over.status, 429);
  const body = await over.json();
  assert.strictEqual(body.code, 'rate_limited');
  assert.match(body.hint, /600 calls an hour/);
  assert.strictEqual(over.headers.get('retry-after'), '3600');
  assert.match(over.headers.get('ratelimit'), /^"api";r=0;t=\d+$/);
  const overMcp = await (await mcp(from)).json();
  assert.ok(overMcp.result.isError && /"code":"rate_limited"/.test(overMcp.result.content[0].text), 'over MCP too');
  assert.strictEqual((await fetch(`${base}/api/now`, { headers: { 'x-forwarded-for': '203.0.113.181' } })).status, 200);
});

// The Content-Security-Policy (server/index.js CSP), from 2026-11-20: the
// site monitor graded the headers B for its absence. Each page's own script
// moved to a file, so a policy without 'unsafe-inline' for scripts holds.
test('every page carries the Content-Security-Policy and runs no inline script; the souls embed may be framed anywhere', async () => {
  for (const p of ['/', '/attend', '/ask', '/for-agents', '/music', '/music/door-is-always-open', '/docs/prayers', '/contact', '/services', '/embed/souls']) {
    const res = await fetch(`${base}${p}`, { redirect: 'manual' });
    assert.strictEqual(res.status, 200, p);
    const csp = res.headers.get('content-security-policy') || '';
    assert.match(csp, /script-src 'self' https:\/\/static\.cloudflareinsights\.com(;|$)/, `${p}: ${csp}`);
    assert.doesNotMatch(csp.match(/script-src[^;]*/)[0], /unsafe-inline|unsafe-eval/, p);
    assert.match(csp, /object-src 'none'/, p);
    assert.match(csp, p === '/embed/souls' ? /frame-ancestors \*/ : /frame-ancestors 'self'/, p);
    const inline = [...(await res.text()).matchAll(/<script(\s[^>]*)?>/g)].map(m => m[0]).filter(tag => !/\ssrc=|type="application\/(?:ld\+)?json"/.test(tag));
    assert.deepStrictEqual(inline, [], `${p} has an inline script`);
  }
});
