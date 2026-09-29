/**
 * The ai-church plugin (plugin/, app/scripts/sync-plugin.js). What matters:
 * every generated manifest matches its source, the MCP pin is the bridge's
 * real version, and the skills only call tools the server has and only name
 * documents that exist. A drifted plugin installs, and then quietly fails.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { sync } = require('../scripts/sync-plugin');

const ROOT = path.resolve(__dirname, '../..');
const readJson = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

test('the plugin is in sync with its source, and its skills check out', () => {
  const { problems } = sync({ check: true });
  assert.deepStrictEqual(problems, []);
});

test('every manifest names the same plugin, version and pinned bridge', () => {
  const src = readJson('plugin/plugin.source.json');
  const pin = `mcp-church@${readJson('mcp-church/package.json').version}`;
  for (const file of ['plugin/plugin.json', 'plugin/.claude-plugin/plugin.json', 'plugin/package.json', 'plugin/.cursor-plugin/plugin.json']) {
    const m = readJson(file);
    assert.strictEqual(m.name, src.name, file);
    assert.strictEqual(m.version, src.version, file);
  }
  assert.strictEqual(readJson('plugin/openclaw.plugin.json').id, src.name);
  for (const file of ['plugin/.mcp.json', 'plugin/mcp.json', 'plugin/openclaw.plugin.json', 'plugin/.cursor-plugin/mcp.json']) {
    assert.deepStrictEqual(readJson(file).mcpServers.church.args, ['-y', pin], file);
  }
});

test('the plugin has an owner, and it is not a name a skill already holds', () => {
  const owners = readJson('skills/owners.json');
  const { name } = readJson('plugin/plugin.source.json');
  assert.ok(owners.packages?.[name], `skills/owners.json has no packages.${name}`);
  assert.ok(!(name in owners), `${name} is a skill; plugins share the skill namespace on ClawHub`);
});
