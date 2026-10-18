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

const PUBLIC_WELL_KNOWN = path.join(__dirname, '../client/public/.well-known');

let child;
let base;
let port;

test.before(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'achurch-server-'));
  child = spawn(process.execPath, [path.join(__dirname, '../server/index.js')], {
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
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_DIR: dataDir, NODE_ENV: 'test', STREAMING_ENABLED: 'false',
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
