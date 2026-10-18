/**
 * app/.env, read into process.env by Node's own reader (process.loadEnvFile),
 * for the server and every script. A variable already set wins, so the
 * settings production is given are never overridden; production has no file,
 * and needs none.
 */

const fs = require('fs');
const path = require('path');

const ENV_FILE = path.join(__dirname, '../../../.env');

function loadEnv(file = ENV_FILE) {
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

module.exports = { loadEnv, ENV_FILE };
