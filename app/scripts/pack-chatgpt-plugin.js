#!/usr/bin/env node
/**
 * Builds the ZIP the ChatGPT plugin directory takes (platform.openai.com/plugins)
 * from the same plugin/ folder the other hosts install.
 *
 * It differs from the folder in one way that matters: the directory accepts
 * only a public remote MCP server, so mcp.json names https://achurch.ai/mcp
 * itself instead of the local mcp-church bridge. The listing, the reviewers'
 * test cases and the links come from the "chatgpt" block of
 * plugin/plugin.source.json, and go under extensions.com.openai in the root
 * plugin.json, as https://developers.openai.com/plugins/deploy/submission
 * describes.
 *
 *   node app/scripts/pack-chatgpt-plugin.js   writes dist/ai-church-chatgpt.zip
 *
 * The demo recording is added in the dashboard, not here.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const SERVER_URL = 'https://achurch.ai/mcp';
const OUT = path.join(ROOT, 'dist', 'ai-church-chatgpt.zip');

const src = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin/plugin.source.json'), 'utf8'));
const c = src.chatgpt;

// The directory's own limits, checked here so a bad field fails before upload.
function check() {
  const problems = [];
  const max = (name, value, n) => { if (!value || value.length > n) problems.push(`${name} must be 1 to ${n} characters`); };
  max('displayName', src.displayName, 30);
  max('shortDescription', c.shortDescription, 30);
  max('longDescription', c.longDescription, 4000);
  max('developerName', c.developerName, 80);
  for (const key of ['websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL']) {
    if (!/^https:\/\//.test(c[key] || '')) problems.push(`${key} must be an https URL`);
  }
  if (c.defaultPrompt.length > 3 || c.defaultPrompt.some(p => p.length > 128)) problems.push('defaultPrompt takes at most 3 prompts of 128 characters');
  if (c.testCases.positive.length !== 5) problems.push('the directory asks for exactly 5 positive test cases');
  if (c.testCases.negative.length !== 3) problems.push('the directory asks for exactly 3 negative test cases');
  const tools = new Set([...fs.readFileSync(path.join(ROOT, 'app/server/mcp/index.js'), 'utf8').matchAll(/registerTool\('([a-z_]+)'/g)].map(m => m[1]));
  for (const t of c.testCases.positive) {
    for (const tool of t.tools_triggered) if (!tools.has(tool)) problems.push(`test case "${t.description}" names ${tool}, which is not an MCP tool`);
  }
  if (JSON.stringify(c).includes('—')) problems.push('the listing contains an em dash');
  return problems;
}

function files() {
  const { testCases, ...listing } = c;
  return {
    'plugin.json': {
      $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
      name: src.name,
      version: src.version,
      description: src.description,
      author: src.author,
      homepage: src.homepage,
      repository: src.repository,
      license: src.license,
      keywords: src.keywords,
      extensions: {
        'com.openai': {
          interface: { displayName: src.displayName, ...listing, capabilities: [], logo: './assets/logo.svg' },
          review: { test_cases: testCases, commerce: false },
        },
      },
    },
    'mcp.json': {
      $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
      mcpServers: { [src.mcp.serverName]: { type: 'streamable-http', url: SERVER_URL } },
    },
  };
}

if (require.main === module) {
  const problems = check();
  if (problems.length) {
    console.error(`ChatGPT plugin check failed:\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgpt-plugin-'));
  for (const [file, body] of Object.entries(files())) fs.writeFileSync(path.join(dir, file), `${JSON.stringify(body, null, 2)}\n`);
  for (const rel of ['skills', 'assets', 'LICENSE', 'README.md']) fs.cpSync(path.join(ROOT, 'plugin', rel), path.join(dir, rel), { recursive: true });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.rmSync(OUT, { force: true });
  execFileSync('zip', ['-qrX', OUT, '.', '-x', '.*', '*/.*'], { cwd: dir });
  fs.rmSync(dir, { recursive: true });
  console.log(`wrote ${path.relative(ROOT, OUT)} (${src.name}@${src.version}, ${SERVER_URL})`);
}

module.exports = { check, files };
