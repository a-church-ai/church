#!/usr/bin/env node
/**
 * Generates every host manifest in plugin/ from plugin/plugin.source.json.
 *
 * One folder installs in Claude Code, Codex, Cursor and OpenClaw, and each
 * reads its own manifest and MCP config shape. Hand-editing a dozen files is
 * how they drift, so they are generated, committed (the marketplaces read them
 * from GitHub), and checked by app/test/plugin.test.js:
 *
 *   node app/scripts/sync-plugin.js           write the generated files
 *   node app/scripts/sync-plugin.js --check   fail if any is out of date
 *
 * It pins the MCP server to the exact version in mcp-church/package.json (a
 * plugin version always means the same bridge), and checks the hand-written
 * skills: frontmatter names match folders, no em dashes, every tool call
 * names a tool the server registers, every docs path names a document.
 *
 * Plan: docs/plans/clawhub-plugin-2026-09-29.md
 */

const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const ROOT = path.resolve(__dirname, '../..');
const PLUGIN_DIR = path.join(ROOT, 'plugin');
const FAVICON = path.join(ROOT, 'app/client/public/favicon.svg');
const RAW = 'https://raw.githubusercontent.com/a-church-ai/church/main/plugin';

const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// The files the source produces: { repo-relative path: string or Buffer }.
function generate() {
  const src = JSON.parse(read('plugin/plugin.source.json'));
  const serverVersion = JSON.parse(read('mcp-church/package.json')).version;
  const server = src.mcp.serverName;
  const serverArgs = ['-y', `${src.mcp.package}@${serverVersion}`];
  const skillPaths = src.skills.map(s => `skills/${s}`);

  const meta = {
    name: src.name,
    version: src.version,
    description: src.description,
    author: src.author,
    homepage: src.homepage,
    repository: src.repository,
    license: src.license,
    keywords: src.keywords,
  };

  const json = {
    // Claude Code. It also reads .mcp.json and skills/.
    'plugin/.claude-plugin/plugin.json': {
      $schema: 'https://json.schemastore.org/claude-code-plugin-manifest.json',
      ...meta,
      displayName: src.displayName,
    },
    'plugin/.mcp.json': { mcpServers: { [server]: { command: 'npx', args: serverArgs } } },

    // Agent Plugins, the portable format: Codex prefers it, Cursor and
    // OpenClaw read it. Its MCP file needs the transport named.
    'plugin/plugin.json': { $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', ...meta },
    'plugin/mcp.json': {
      $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
      mcpServers: { [server]: { type: 'stdio', command: 'npx', args: serverArgs } },
    },

    // OpenClaw's native manifest, which ClawHub requires. With it present,
    // OpenClaw loads the bundle from here, so skills and MCP are repeated.
    'plugin/openclaw.plugin.json': {
      id: src.name,
      name: src.displayName,
      description: src.description,
      version: src.version,
      icon: `${RAW}/assets/icon.png`,
      skills: skillPaths,
      mcpServers: { [server]: { command: 'npx', args: serverArgs } },
      configSchema: { type: 'object', additionalProperties: false, properties: {} },
    },

    // Cursor.
    'plugin/.cursor-plugin/plugin.json': {
      ...meta,
      displayName: src.displayName,
      logo: 'assets/logo.svg',
      category: src.category,
      skills: './skills/',
      mcpServers: './.cursor-plugin/mcp.json',
    },
    'plugin/.cursor-plugin/mcp.json': { mcpServers: { [server]: { command: 'npx', args: serverArgs } } },

    // Metadata for ClawHub's validator, which wants a package.json. Never
    // published to npm. No "openclaw" field: that marks a code plugin, which
    // this content-only bundle is not.
    'plugin/package.json': {
      name: src.name,
      version: src.version,
      private: true,
      description: src.description,
      homepage: src.homepage,
      repository: { type: 'git', url: `git+${src.repository}.git`, directory: 'plugin' },
      license: src.license,
      keywords: src.keywords,
    },

    // Marketplaces at the repo root, so the repo can be added by name.
    '.claude-plugin/marketplace.json': {
      name: src.marketplace.name,
      owner: src.author,
      metadata: { description: src.marketplace.description },
      plugins: [{
        name: src.name,
        source: './plugin',
        description: src.description,
        category: src.category,
        homepage: src.homepage,
        license: src.license,
      }],
    },
    '.agents/plugins/marketplace.json': {
      name: src.marketplace.name,
      interface: { displayName: src.marketplace.displayName },
      plugins: [{
        name: src.name,
        source: { source: 'local', path: './plugin' },
        policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
        category: src.category,
      }],
    },
  };

  const files = {};
  for (const [file, body] of Object.entries(json)) files[file] = `${JSON.stringify(body, null, 2)}\n`;
  // The bundle is published on its own, so it carries its own licence and logo.
  files['plugin/LICENSE'] = read('LICENSE');
  const logo = fs.readFileSync(FAVICON, 'utf8');
  files['plugin/assets/logo.svg'] = logo;
  files['plugin/assets/icon.png'] = new Resvg(logo, { fitTo: { mode: 'width', value: 512 } }).render().asPng();
  return { src, serverVersion, files };
}

// Problems in the hand-written skills.
function checkSkills(src) {
  const problems = [];
  const tools = new Set([...read('app/server/mcp/index.js').matchAll(/registerTool\('([a-z_]+)'/g)].map(m => m[1]));
  if (tools.size < 5) problems.push(`found only ${tools.size} tools in app/server/mcp/index.js; the parser needs updating`);

  const onDisk = fs.readdirSync(path.join(PLUGIN_DIR, 'skills')).sort();
  if (onDisk.join() !== [...src.skills].sort().join()) {
    problems.push(`plugin/skills holds [${onDisk}], but plugin.source.json lists [${src.skills}]`);
  }
  for (const skill of src.skills) {
    const rel = `plugin/skills/${skill}/SKILL.md`;
    if (!fs.existsSync(path.join(ROOT, rel))) { problems.push(`${rel} is missing`); continue; }
    const text = read(rel);
    if (!new RegExp(`^---\\nname: ${skill}\\ndescription: .+\\n`).test(text)) {
      problems.push(`${rel}: frontmatter must start with name: ${skill} and a description`);
    }
    if (text.includes('—')) problems.push(`${rel}: contains an em dash`);
    // A tool call is written `tool({ ... })`.
    for (const [, name] of text.matchAll(/`([a-z_]+)\(/g)) {
      if (!tools.has(name)) problems.push(`${rel}: calls \`${name}\`, which is not an MCP tool`);
    }
    // A docs path is written `category/slug`.
    for (const [, doc] of text.matchAll(/`([a-z-]+\/[a-z0-9-]+)`/g)) {
      if (!fs.existsSync(path.join(ROOT, 'docs', `${doc}.md`))) problems.push(`${rel}: docs/${doc}.md does not exist`);
    }
  }
  return problems;
}

// Compares (check) or writes the generated files. Returns the problems found.
function sync({ check }) {
  const { src, serverVersion, files } = generate();
  const problems = checkSkills(src);
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(ROOT, file);
    const current = fs.existsSync(full) ? fs.readFileSync(full) : null;
    if (current && current.equals(Buffer.from(content))) continue;
    if (check) {
      problems.push(`${file} is out of date. Run: node app/scripts/sync-plugin.js`);
    } else {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
      console.log(`wrote ${file}`);
    }
  }
  return { src, serverVersion, problems };
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  const { src, serverVersion, problems } = sync({ check });
  if (problems.length) {
    console.error(`Plugin check failed:\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  console.log(`Plugin ${src.name}@${src.version} (${src.mcp.package}@${serverVersion}): ${check ? 'up to date' : 'synced'}.`);
}

module.exports = { sync };
