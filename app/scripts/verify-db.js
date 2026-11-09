#!/usr/bin/env node
/**
 * The database's one promise, checked where it runs: the publishable (anon)
 * key can neither read nor add to any table, nor call any function, so only
 * the server's secret key reaches anything (supabase/migrations/). After
 * satchitananda's verify-db.
 *
 *   npm run verify-db               the local database (supabase start)
 *   npm run verify-db -- --prod     the hosted project, from app/.env.prod
 *
 * Run after every migration pushed to the hosted project. Settings for --prod
 * come from app/.env.prod (git-ignored), never app/.env, so a run against
 * production is always a choice: SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { schema, openToAnon } = require('../server/lib/db/schema');

// The local stack's fixed development values, valid nowhere else.
const LOCAL = { url: 'http://127.0.0.1:56121', key: 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH' };

function target(argv) {
  if (!argv.includes('--prod')) return { where: 'local', ...LOCAL };
  const file = path.join(__dirname, '..', '.env.prod');
  if (!fs.existsSync(file)) throw new Error('--prod needs app/.env.prod with SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY');
  const env = {};
  for (const m of fs.readFileSync(file, 'utf8').matchAll(/^([A-Z_]+)=("?)(.*)\2\s*$/gm)) env[m[1]] = m[3];
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) throw new Error('app/.env.prod needs SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY');
  return { where: 'prod', url: env.SUPABASE_URL, key: env.SUPABASE_PUBLISHABLE_KEY };
}

async function main() {
  const { where, url, key } = target(process.argv.slice(2));
  const found = schema();
  const { tables, functions } = found;
  console.log(`${where}: ${url}, ${tables.length} tables and ${functions.length} functions from the migrations`);
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const open = await openToAnon(client, found);
  if (open.length) {
    console.error(`The publishable key reaches ${open.length}:\n${open.map(o => `  ${o}`).join('\n')}`);
    process.exit(1);
  }
  console.log('The publishable key reaches nothing.');
}

main().catch(err => { console.error(err.message); process.exit(1); });
