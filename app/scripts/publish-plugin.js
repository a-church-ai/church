#!/usr/bin/env node
/**
 * Publishes the ai-church bundle plugin (plugin/) to ClawHub, as the account
 * skills/owners.json names under `packages`, with the same guarantees as
 * publish-skills.js: --account is required, the token goes through a private
 * temporary config (lib/clawhub.js), and the run refuses unless the token's
 * handle is the plugin's owner.
 *
 * Before publishing it runs the sync check (manifests, MCP pin, skills) and
 * ClawHub's validator, and refuses a version already live. The release links
 * to the current commit, so plugin/ must be committed and the commit on
 * origin/main.
 *
 * Usage:
 *   node app/scripts/publish-plugin.js --account achurchai --dry-run
 *   node app/scripts/publish-plugin.js --account achurchai --changelog "What changed"
 *
 * The version is plugin.source.json's. Bump it and rerun sync-plugin.js for
 * each release.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { clawhub, fail, owners, signIn, REPO_ROOT } = require('./lib/clawhub');
const { sync } = require('./sync-plugin');

const args = process.argv.slice(2);
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const DRY_RUN = args.includes('--dry-run');
const ACCOUNT = option('--account');
const CHANGELOG = option('--changelog');

const PLUGIN_REL = 'plugin';
const PLUGIN_DIR = path.join(REPO_ROOT, PLUGIN_REL);
const SOURCE_REPO = 'a-church-ai/church';

const git = (...gitArgs) => execFileSync('git', gitArgs, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const output = err => `${err.stdout || ''}${err.stderr || ''}`.trim();

function live(name) {
  try {
    const data = JSON.parse(clawhub(['package', 'inspect', name, '--json']));
    return { version: data.package?.latestVersion ?? null, owner: data.owner?.handle ?? null };
  } catch {
    return { version: null, owner: null }; // not published yet, or its scan is pending
  }
}

function main() {
  const { src, serverVersion, problems } = sync({ check: true });
  if (problems.length) fail(`Plugin check failed:\n- ${problems.join('\n- ')}`);
  const { name, displayName, version } = src;
  const topics = src.clawhub.topics;
  if (topics.length > 5) fail(`ClawHub allows at most 5 topics; plugin.source.json lists ${topics.length}.`);

  // 1. Account and ownership
  const { handle, key } = signIn(ACCOUNT);
  const owner = owners().packages?.[name];
  if (!owner) fail(`${name} has no owner under "packages" in skills/owners.json.`);
  if (owner !== handle) fail(`${name} is owned by @${owner} per skills/owners.json, but ${key} is @${handle}.`);
  console.log(`${name} ${version} (mcp-church@${serverVersion}) as @${handle}${DRY_RUN ? ', dry run' : ''}`);

  // 2. ClawHub's validator. It writes reports/, which is not part of the plugin.
  try {
    const out = clawhub(['package', 'validate', '.'], { cwd: PLUGIN_DIR, timeout: 300000 });
    console.log(out.trim().split('\n').filter(l => /Plugin Inspector|Breakages|Warnings|Findings|PASS|FAIL/.test(l)).join('\n'));
  } catch (err) {
    fail(`ClawHub validation failed:\n${output(err)}`);
  } finally {
    fs.rmSync(path.join(PLUGIN_DIR, 'reports'), { recursive: true, force: true });
  }

  // 3. The registry: whose listing it is, and whether this version is new
  const current = live(name);
  if (current.owner && current.owner !== handle) fail(`${name} is already listed under @${current.owner}, not @${handle}.`);
  if (current.version === version) fail(`${version} is already live. Bump the version in plugin/plugin.source.json and sync.`);
  console.log(`Registry: ${current.version ? `${current.version} live` : 'not published yet'} -> ${version}`);

  // 4. The source link: plugin/ committed, and the commit on origin/main
  const dirty = git('status', '--porcelain', '--', PLUGIN_REL);
  const commit = git('rev-parse', 'HEAD');
  let pushed = false;
  try {
    git('fetch', '--quiet', 'origin', 'main');
    pushed = git('branch', '-r', '--contains', commit).split('\n').some(b => b.trim() === 'origin/main');
  } catch { /* treated as not pushed */ }
  if (dirty || !pushed) {
    const why = dirty ? `uncommitted changes in ${PLUGIN_REL}/` : `commit ${commit.slice(0, 7)} is not on origin/main`;
    if (!DRY_RUN) fail(`Cannot link the release to its source: ${why}. Commit and push first.`);
    console.log(`Would refuse to publish: ${why}.`);
  }

  // 5. Publish
  const publishArgs = [
    'package', 'publish', PLUGIN_REL,
    '--family', 'bundle-plugin',
    '--name', name,
    '--display-name', displayName,
    '--owner', handle,
    '--version', version,
    '--topics', topics.join(','),
    '--source-repo', SOURCE_REPO,
    '--source-commit', commit,
    '--source-ref', 'main',
    '--source-path', PLUGIN_REL,
    ...(CHANGELOG ? ['--changelog', CHANGELOG] : []),
    ...(DRY_RUN ? ['--dry-run'] : ['--wait', '--wait-timeout', '900']),
  ];
  console.log(`\n$ clawhub ${publishArgs.join(' ')}\n`);
  try {
    console.log(clawhub(publishArgs, { cwd: REPO_ROOT, timeout: 1000000 }).trim());
  } catch (err) {
    // The upload went through and ClawHub's security scan is still running:
    // the release goes public (or is held) on its own.
    if (/still pending/i.test(output(err))) {
      console.log(`\nSubmitted ${version}; ClawHub's security scan is still running. Recheck: npx clawhub@latest package moderation-status ${name}`);
      return;
    }
    fail(`Publish failed:\n${output(err)}`);
  }
  if (!DRY_RUN) console.log(`\nPublished. Install: openclaw plugins install clawhub:${name}`);
}

main();
