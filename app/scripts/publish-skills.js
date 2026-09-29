#!/usr/bin/env node
/**
 * Publishes the skills in skills/ to ClawHub, as one explicit account.
 *
 * aChurch skills are spread across ClawHub accounts (achurch, church and
 * ask-church under lucasgeeksinthewood; newer ones under achurchai), and
 * skills/.env also holds tokens for other projects' accounts. Publishing from
 * an account that doesn't own a skill has cost a project an account before, so
 * every run:
 *   - requires --account and reads CLAWHUB_TOKEN_<ACCOUNT> from skills/.env
 *   - hands that token to the CLI through a temporary config file
 *     (CLAWHUB_CONFIG_PATH), never touching your own `clawhub login`
 *   - prints the handle the token belongs to before doing anything
 *   - publishes only the skills skills/owners.json assigns to that handle.
 *     The registry alone can't be trusted for this: a skill waiting on its
 *     security scan is not public yet, so it looks unclaimed to any other
 *     account, which would then publish it as its own.
 *   - skips a skill whose frontmatter version is already published
 *
 * Usage:
 *   node app/scripts/publish-skills.js --account achurchai --dry-run
 *   node app/scripts/publish-skills.js --account lucasgeeksinthewoods
 *   node app/scripts/publish-skills.js --account achurchai --only agent-rituals
 *   node app/scripts/publish-skills.js --account lucasgeeksinthewoods --only church --name "New Display Name"
 *
 * A new skill is published under the account that runs it, named by its H1.
 * An update keeps the listing's current display name unless --name renames it
 * (one skill at a time, so a name can't land on the wrong listing). Publishing accepts
 * ClawHub's platform license for skill text (MIT-0); see skills/README.md.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);

const DRY_RUN = flag('--dry-run');
const ACCOUNT = option('--account');
const ONLY = option('--only') ? option('--only').split(',').map(s => s.trim()) : null;
const NAME = option('--name');
if (NAME && (!ONLY || ONLY.length !== 1)) {
  console.error('--name renames one skill: pass it with --only <slug>.');
  process.exit(1);
}

const REPO_ROOT = path.resolve(__dirname, '../..');
const SKILLS_DIR = path.join(REPO_ROOT, 'skills');
const ENV_FILE = path.join(SKILLS_DIR, '.env');
const OWNERS = JSON.parse(fs.readFileSync(path.join(SKILLS_DIR, 'owners.json'), 'utf8'));
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

// The token goes into a private temporary config, so this run cannot publish
// as whoever is logged in globally. Returns the handle the token belongs to.
function signIn() {
  if (!ACCOUNT) fail('Missing --account: the ClawHub account to publish as (reads CLAWHUB_TOKEN_<ACCOUNT> from skills/.env).');
  const key = `CLAWHUB_TOKEN_${ACCOUNT.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
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

function frontmatter(content) {
  const block = content.match(/^---\n([\s\S]*?)\n---/);
  const fields = {};
  for (const line of block ? block[1].split('\n') : []) {
    const kv = line.match(/^(\w[\w-]*):\s*"?(.+?)"?\s*$/);
    if (kv) fields[kv[1]] = kv[2];
  }
  return fields;
}

function published(slug) {
  try {
    const data = JSON.parse(clawhub(['inspect', slug, '--json']));
    return {
      version: data.latestVersion?.version || data.version || null,
      owner: data.owner?.handle ?? null,
      displayName: data.skill?.displayName ?? null,
    };
  } catch {
    return null;
  }
}

function main() {
  const { handle, key } = signIn();
  const skills = fs.readdirSync(SKILLS_DIR)
    .filter(dir => fs.existsSync(path.join(SKILLS_DIR, dir, 'SKILL.md')))
    .filter(dir => !ONLY || ONLY.includes(dir))
    .sort();

  console.log(`Publishing as @${handle} (${key})${DRY_RUN ? ', dry run' : ''}\n`);
  const otherOwner = [];
  const failed = [];

  for (const slug of skills) {
    if (!OWNERS[slug]) { failed.push(`${slug}: no owner in skills/owners.json`); continue; }
    if (OWNERS[slug] !== handle) { otherOwner.push(`${slug} (@${OWNERS[slug]})`); continue; }

    const content = fs.readFileSync(path.join(SKILLS_DIR, slug, 'SKILL.md'), 'utf8');
    const version = frontmatter(content).version;
    if (!version) { failed.push(`${slug}: no version in frontmatter`); continue; }

    const current = published(slug);
    if (current?.owner && current.owner !== handle) {
      failed.push(`${slug}: skills/owners.json says @${handle}, but ClawHub says @${current.owner}`);
      continue;
    }
    if (current && current.version === version) { console.log(`  ${slug} ${version}: already published`); continue; }

    const name = NAME || current?.displayName || (content.match(/^#\s+(.+)$/m) || [])[1] || slug;
    const renamed = NAME && current?.displayName && NAME !== current.displayName ? `, renamed from "${current.displayName}"` : '';
    const change = (current ? `${current.version} -> ${version}` : `new, ${version}`) + renamed;
    const publishArgs = ['publish', path.join(SKILLS_DIR, slug), '--slug', slug, '--name', name,
      '--version', version, '--owner', handle, ...(DRY_RUN ? ['--dry-run'] : [])];
    try {
      clawhub(publishArgs);
      console.log(`  ${slug} ${change}: ${DRY_RUN ? 'would publish' : 'published'} as "${name}"`);
    } catch (err) {
      failed.push(`${slug}: ${(err.stderr || err.message).trim().split('\n').pop()}`);
    }
  }

  if (otherOwner.length) console.log(`\nOwned by another account, not touched (rerun with its --account):\n  ${otherOwner.join('\n  ')}`);
  if (failed.length) fail(`\nFailed:\n  ${failed.join('\n  ')}`);
}

main();
