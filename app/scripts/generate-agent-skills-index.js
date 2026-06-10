#!/usr/bin/env node
/**
 * Generates /.well-known/agent-skills/index.json from the on-disk skills/ tree.
 *
 * Per agentskills.io v0.2.0 — schema: https://schemas.agentskills.io/discovery/0.2.0/schema.json
 * Each entry: name, type, description, url, digest (sha256).
 *
 * Run: node app/scripts/generate-agent-skills-index.js
 * Also runs automatically via `npm run dev` and a pre-deploy hook (see package.json).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '../..');
const SKILLS_DIR = path.join(REPO_ROOT, 'skills');
const OUT_PATH = path.join(REPO_ROOT, 'app/client/public/.well-known/agent-skills/index.json');
const BASE_URL = 'https://achurch.ai';

/**
 * Minimal YAML frontmatter parser — handles only what SKILL.md files actually use:
 * top-level scalars (`name: x`, `description: "x"`) and ignores nested structures.
 * We need `name` and `description` only.
 */
function parseFrontmatter(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  const lines = m[1].split(/\r?\n/);
  for (const line of lines) {
    // Only consider top-level keys (no leading whitespace)
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    let val = kv[2].trim();
    // Strip surrounding quotes if present
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (val === '' || val === '|' || val === '>') continue;  // skip block scalars and empty
    out[kv[1]] = val;
  }
  return out;
}

function sha256(buf) {
  return 'sha256:' + crypto.createHash('sha256').update(buf).digest('hex');
}

function main() {
  if (!fs.existsSync(SKILLS_DIR)) {
    console.error(`skills/ not found at ${SKILLS_DIR}`);
    process.exit(1);
  }

  const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();

  const skills = [];
  for (const name of entries) {
    const skillPath = path.join(SKILLS_DIR, name, 'SKILL.md');
    if (!fs.existsSync(skillPath)) continue;

    const buf = fs.readFileSync(skillPath);
    const md = buf.toString('utf8');
    const fm = parseFrontmatter(md);

    const description = (fm.description || '').toString().slice(0, 1024);
    if (!description) {
      console.warn(`Skipping ${name}: no description in frontmatter`);
      continue;
    }
    if (!/^[a-z0-9-]{1,64}$/.test(name)) {
      console.warn(`Skipping ${name}: directory name does not match v0.2.0 schema (lowercase alphanumeric + hyphens, 1-64 chars)`);
      continue;
    }

    skills.push({
      name,
      type: 'skill-md',
      description,
      url: `${BASE_URL}/.well-known/agent-skills/${name}/SKILL.md`,
      digest: sha256(buf),
    });
  }

  const out = {
    $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
    skills,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n');
  console.log(`Wrote ${OUT_PATH} with ${skills.length} skill(s):`);
  for (const s of skills) console.log(`  - ${s.name}  ${s.digest.slice(0, 19)}…`);
}

main();
