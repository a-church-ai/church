/**
 * ClawHub CLI access as one explicit account, shared by publish-skills.js and
 * publish-plugin.js.
 *
 * skills/.env holds tokens for several accounts, some of them other
 * projects'. Publishing from an account that doesn't own a listing has cost a
 * project an account before, so the token for the requested account goes
 * into a private temporary config (CLAWHUB_CONFIG_PATH), never touching your
 * own `clawhub login`, and the caller is told whose token it is before doing
 * anything with it.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SKILLS_DIR = path.join(REPO_ROOT, 'skills');
const ENV_FILE = path.join(SKILLS_DIR, '.env');
const OWNERS_FILE = path.join(SKILLS_DIR, 'owners.json');
const REGISTRY = 'https://clawhub.ai';

// The current CLI; old global installs can no longer publish.
function clawhub(cliArgs, opts = {}) {
  return execFileSync('npx', ['-y', 'clawhub@latest', '--registry', REGISTRY, '--no-input', ...cliArgs],
    { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

// The ClawHub account that owns each listing: skills at the top level of
// skills/owners.json, plugins under `packages`.
function owners() {
  return JSON.parse(fs.readFileSync(OWNERS_FILE, 'utf8'));
}

// Puts CLAWHUB_TOKEN_<ACCOUNT> from skills/.env into a private temporary
// config for the rest of this process. Returns the handle the token belongs to.
function signIn(account) {
  if (!account) fail('Missing --account: the ClawHub account to publish as (reads CLAWHUB_TOKEN_<ACCOUNT> from skills/.env).');
  const key = `CLAWHUB_TOKEN_${account.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  const env = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  const match = env.match(new RegExp(`^${key}=["']?([^"'\\s]+)`, 'm'));
  if (!match) fail(`No ${key} in ${ENV_FILE}.`);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawhub-'));
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ registry: REGISTRY, token: match[1] }), { mode: 0o600 });
  process.env.CLAWHUB_CONFIG_PATH = configPath;
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));

  let handle = null;
  try {
    // Interactive output is "✔ handle"; piped output is just "handle".
    const last = clawhub(['whoami']).trim().split('\n').pop() || '';
    handle = last.replace(/^[^A-Za-z0-9_-]+/, '').trim().split(/\s+/)[0] || null;
  } catch { /* reported below */ }
  if (!handle) fail(`${key} did not authenticate (clawhub whoami failed).`);
  return { handle, key };
}

module.exports = { clawhub, fail, owners, signIn, REPO_ROOT, SKILLS_DIR };
