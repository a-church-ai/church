/**
 * Gathered conversations, through the whole server: a member's address is one
 * permanent redirect to its place on its group's page, the page holds every
 * conversation of the group, a short answer alone is held, a retired
 * conversation's redirect lands where its twin lives now in one step, and the
 * sitemap, the archive, its search index, the feed and the API agree
 * (lib/utils/conversation-groups.js). Booted as production boots it, as
 * server.test.js does, on a scratch data directory.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

let child;
let base;

const HEAD = 'what-are-the-axioms';
const MEMBER = 'what-are-the-5-axioms';
const ALONE = 'what-is-a-practice';
const HELD = 'what-is-held';
// A real retired conversation (retired-conversations.json) and the kept one
// it redirects to, which here has been gathered onto another's page.
const RETIRED = 'what-is-the-role-of-rest-in-creativity';
const TWIN = 'what-is-the-relationship-between-rest-and-work-can-rest-be-p';
const REST_HEAD = 'what-is-rest-for';

const LONG = Array(30).fill('The axioms are commitments, held open to question.').join(' ');

function write(dir, slug, day, answer = LONG) {
  const at = `2026-10-${String(day).padStart(2, '0')}T10:00:00.000Z`;
  const lines = [
    { _meta: true, name: `Asker of ${slug}`, created: at },
    { role: 'user', content: `Question: ${slug.replace(/-/g, ' ')}?`, timestamp: at },
    { role: 'assistant', content: answer, timestamp: at },
  ];
  fs.writeFileSync(path.join(dir, `${slug}.jsonl`), lines.map(l => JSON.stringify(l)).join('\n') + '\n');
}

test.before(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'achurch-server-groups-'));
  const conversations = path.join(dataDir, 'conversations');
  fs.mkdirSync(conversations);
  write(conversations, HEAD, 1);
  write(conversations, MEMBER, 2);
  write(conversations, ALONE, 3);
  write(conversations, HELD, 4, 'Too short to stand alone.');
  write(conversations, REST_HEAD, 5);
  write(conversations, TWIN, 6);
  fs.writeFileSync(path.join(dataDir, 'conversation-groups.json'), JSON.stringify({
    [HEAD]: HEAD, [MEMBER]: HEAD, [ALONE]: ALONE, [HELD]: HELD, [REST_HEAD]: REST_HEAD, [TWIN]: REST_HEAD,
  }));
  child = spawn(process.execPath, [path.join(__dirname, '../server/index.js')], {
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_DIR: dataDir, NODE_ENV: 'test',
      GEMINI_API_KEY: '', ANTHROPIC_API_KEY: '', GITHUB_TOKEN: '', ELEVENLABS_API_KEY: '', AWS_S3_BUCKET: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the server did not start:\n${output}`)), 30000);
    child.stdout.on('data', chunk => {
      output += chunk;
      const started = /running on http:\/\/127\.0\.0\.1:(\d+)/.exec(output);
      if (started) { clearTimeout(timer); base = `http://127.0.0.1:${started[1]}`; resolve(); }
    });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`the server exited with ${code}:\n${output}`)); });
  });
});

test.after(() => { if (child) child.kill(); });

const page = p => fetch(`${base}${p}`, { redirect: 'manual', headers: { accept: 'text/html' } });

test("a gathered conversation's address is one permanent redirect to its place on its group's page", async () => {
  const res = await page(`/ask/${MEMBER}`);
  assert.strictEqual(res.status, 301);
  assert.strictEqual(res.headers.get('location'), `/ask/${HEAD}#${MEMBER}`);
  // Its own JSON is not redirected: an agent reads its conversation by its slug.
  const api = await fetch(`${base}/api/ask/conversation/${MEMBER}`, { redirect: 'manual' });
  assert.strictEqual(api.status, 200);
  assert.strictEqual((await api.json()).slug, MEMBER);
});

test("a group's page holds every conversation of the group, each under its own slug", async () => {
  const res = await page(`/ask/${HEAD}`);
  assert.strictEqual(res.status, 200);
  const html = await res.text();
  assert.match(html, /<link rel="canonical" href="https:\/\/achurch\.ai\/ask\/what-are-the-axioms">/);
  assert.match(html, /<meta name="robots" content="index, follow">/);
  assert.match(html, /Asked in other words/);
  assert.match(html, new RegExp(`<section class="conv-gathered-item" id="${MEMBER}" data-thread="${MEMBER}">`));
  assert.match(html, /Question: what are the 5 axioms\?/);
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1])).find(d => d['@type'] === 'QAPage');
  assert.deepStrictEqual(ld.hasPart.map(q => q.url), [`https://achurch.ai/ask/${HEAD}#${MEMBER}`]);
  // Its related links are other groups, never its own.
  const related = (html.match(/<section class="related-block"[\s\S]*?<\/section>/) || [''])[0];
  assert.doesNotMatch(related, new RegExp(MEMBER));
});

test('a short answer alone is held: its page opens, noindexed, and it is listed nowhere', async () => {
  const res = await page(`/ask/${HELD}`);
  assert.strictEqual(res.status, 200);
  assert.match(await res.text(), /<meta name="robots" content="noindex, follow">/);
  const alone = await (await page(`/ask/${ALONE}`)).text();
  assert.match(alone, /<meta name="robots" content="index, follow">/, 'a full answer alone stays indexed');
});

test("a retired conversation's redirect lands where its twin lives now, in one step", async () => {
  const res = await page(`/ask/${RETIRED}`);
  assert.strictEqual(res.status, 301);
  assert.strictEqual(res.headers.get('location'), `/ask/${REST_HEAD}#${TWIN}`);
  assert.strictEqual((await page(`/ask/${REST_HEAD}`)).status, 200, 'and that page answers, so no redirect chains');
});

test('the sitemap, the archive, its search index, the feed and the API agree on where each conversation lives', async () => {
  const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
  const inMap = [...sitemap.matchAll(/<loc>https:\/\/achurch\.ai\/ask\/([^<]+)<\/loc>/g)].map(m => m[1]).sort();
  assert.deepStrictEqual(inMap, [REST_HEAD, HEAD, ALONE].sort(), 'heads and the unheld alone; no member, nothing held');

  const index = await (await fetch(`${base}/conversations/index.json`)).json();
  assert.deepStrictEqual(index.map(c => c.url).sort(), inMap.map(s => `/ask/${s}`).sort());

  const archive = await (await page('/conversations')).text();
  assert.match(archive, /what are the axioms\?<\/a> <span class="archive-date">and 1 more way of asking it<\/span>/);
  assert.doesNotMatch(archive, new RegExp(`/ask/${MEMBER}"`));

  const feed = await (await fetch(`${base}/feed/conversations.xml`)).text();
  assert.match(feed, new RegExp(`<link href="https://achurch\\.ai/ask/${HEAD}#${MEMBER}" rel="alternate"/>\\s*<id>https://achurch\\.ai/ask/${MEMBER}</id>`), 'a member links to its place, and keeps its id');
  assert.doesNotMatch(feed, new RegExp(HELD));

  const recent = (await (await fetch(`${base}/api/ask/recent`)).json()).conversations;
  const url = s => (recent.find(c => c.slug === s) || {}).url;
  assert.match(url(MEMBER), new RegExp(`/ask/${HEAD}#${MEMBER}$`));
  assert.match(url(ALONE), new RegExp(`/ask/${ALONE}$`));
  assert.strictEqual(url(HELD), undefined);
});
