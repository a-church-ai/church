/**
 * The suite runs on the Node the project declares, and says so if it does not.
 *
 * Written after a day spent diagnosing flakiness that was not there. The
 * suite was run on Node 20 while package.json requires 26, and on Node 20 the
 * runner's --test-force-exit dropped whole test files and still printed a
 * green result: totals wandered between 468 and 504 across runs, every one of
 * them reporting no failures. Nothing warned. The flag is gone now, and this
 * test is the other half: a wrong runtime should fail loudly here rather than
 * produce an answer that is quietly wrong somewhere else.
 *
 * `.npmrc` sets engine-strict, so a fresh install on the wrong Node is refused
 * too. That does not help a checkout whose node_modules already exist and
 * whose shell has since changed version, which is exactly the case that caught
 * us, so the check belongs in the suite as well as in the installer.
 *
 * What the rest of this file guards is the same thing one level down: the
 * harness must not be able to report an answer it did not measure.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// Only the form the project actually declares, ">=26.12.1" (or a bare major,
// ">=26"). A range this does not understand fails rather than passing, because
// a check that quietly approves of anything it cannot parse is the failure
// mode this file exists to catch.
function floorOf(range) {
  const match = /^>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(String(range || '').trim());
  assert.ok(match, `engines.node is "${range}", which this test cannot read. Teach it the new form rather than deleting the check.`);
  return match.slice(1).map(n => Number(n || 0));
}

const versionOf = v => String(v).replace(/^v/, '').split('.').map(Number);
const atLeast = (version, floor) => {
  for (let i = 0; i < 3; i++) if ((version[i] || 0) !== floor[i]) return (version[i] || 0) > floor[i];
  return true;
};

test('the running Node satisfies engines.node', () => {
  const required = floorOf(pkg.engines && pkg.engines.node);
  assert.ok(
    atLeast(versionOf(process.versions.node), required),
    `This suite is running on Node ${process.versions.node}, but the project requires >=${required.join('.')} `
    + `(package.json engines.node), which is what production, CI and the scheduled jobs run. `
    + `Results on an older Node are not evidence about this project, and an older 26.x may lack a `
    + `security fix the floor exists for. Run \`nvm install 26\` and try again.`,
  );
});

test('the Docker image runs a Node that satisfies engines.node', () => {
  // The third declaration of the one fact: the image production is built
  // from. Pinned to an exact version, so the deployed Node is known.
  const dockerfile = fs.readFileSync(path.join(ROOT, '..', 'Dockerfile'), 'utf8');
  const from = /^FROM node:(\d+\.\d+\.\d+)-slim$/m.exec(dockerfile);
  assert.ok(from, 'the Dockerfile builds FROM node:<major.minor.patch>-slim, an exact version');
  assert.ok(atLeast(versionOf(from[1]), floorOf(pkg.engines && pkg.engines.node)), `node:${from[1]} is older than engines.node`);
});

test('.nvmrc names the same Node the package requires', () => {
  // Two declarations of one fact. They are in different files for different
  // readers, nvm and npm, so nothing but this keeps them together.
  const nvmrc = fs.readFileSync(path.join(ROOT, '..', '.nvmrc'), 'utf8').trim();
  assert.match(nvmrc, /^\d+$/, '.nvmrc should be a bare major version');
  assert.strictEqual(
    Number(nvmrc),
    floorOf(pkg.engines && pkg.engines.node)[0],
    '.nvmrc and package.json engines.node disagree about which Node this project runs on',
  );
});

test('the test script does not force the runner to exit', () => {
  // --test-force-exit terminates the process the moment the runner finishes,
  // which on Node 20 cut off files still reporting and produced green runs
  // that had quietly skipped dozens of tests. It was added on 2026-10-14 as
  // insurance beside the real fix for a server mcp.test.js leaked on a failed
  // connect, and that leak was fixed in the same commit. A suite that hangs is
  // loud and can be diagnosed; a suite that lies is neither.
  assert.ok(
    !pkg.scripts.test.includes('--test-force-exit'),
    'npm test must not pass --test-force-exit: it can end the run before every '
    + 'test file has reported, and the run still prints as green. If a file leaks '
    + 'a handle and hangs the suite, fix the leak.',
  );
});

test('every test server binds the address its test then fetches', () => {
  // A server started with listen(0) binds the wildcard address. macOS sets
  // SO_REUSEADDR, so that bind SUCCEEDS on a port another local process
  // already holds on 127.0.0.1 specifically, and a connection to
  // 127.0.0.1:port is then delivered to the more specific binding: the
  // stranger's server, not ours. The test reads the stranger's reply.
  //
  // That is not hypothetical. It is what made this suite flake. A captured
  // failure had GET /api/attend answer 404 with a Permissions-Policy of
  // "microphone=(self)", a header this app does not set, from some other
  // program on the machine. Binding 127.0.0.1 explicitly makes the collision
  // an EADDRINUSE we can see instead of a wrong answer we cannot.
  const offenders = [];
  for (const file of fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js'))) {
    const body = fs.readFileSync(path.join(__dirname, file), 'utf8');
    body.split('\n').forEach((line, i) => {
      // listen(0, <callback>) rather than listen(0, '127.0.0.1', <callback>).
      if (/\.listen\(0,\s*(\(|function)/.test(line)) offenders.push(`${file}:${i + 1}`);
    });
  }
  assert.deepStrictEqual(
    offenders, [],
    'these test servers bind the wildcard address, so another process holding the '
    + 'same port on 127.0.0.1 would answer their requests instead. Pass the host: '
    + "listen(0, '127.0.0.1', ...)",
  );
});
