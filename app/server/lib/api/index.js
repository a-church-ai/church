/**
 * The operations behind the public API, shared by REST (routes/api.js) and
 * MCP (mcp/). See ./shared for the { status, body } convention.
 */

module.exports = {
  attendance: require('./attendance'),
  music: require('./music'),
  reflections: require('./reflections'),
  contributions: require('./contributions'),
  ask: require('./ask'),
  search: require('./search'),
  directory: require('./directory'),
  services: require('./services'),
  shared: require('./shared'),
};
