#!/usr/bin/env node
/**
 * Writes client/public/webmcp.js from the MCP server's own tool list
 * (server/lib/webmcp.js). Run after changing a tool: npm run gen:webmcp.
 * test/db/webmcp.test.js fails while the committed file is stale.
 */
const fs = require('fs');
const path = require('path');
const { webmcpScript } = require('../server/lib/webmcp');

const OUT = path.join(__dirname, '../client/public/webmcp.js');

webmcpScript().then((script) => {
  fs.writeFileSync(OUT, script);
  console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
}, (err) => {
  console.error(`could not build webmcp.js: ${err.message}`);
  process.exitCode = 1;
});
