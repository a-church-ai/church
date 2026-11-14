/**
 * The tables and functions the migrations make (supabase/migrations/), read
 * from the migrations themselves, so what checks them (test/db/database.test.js,
 * scripts/verify-db.js) covers a table or function added later without being
 * told.
 */

const fs = require('fs');
const path = require('path');

const MIGRATIONS = path.join(__dirname, '../../../../supabase/migrations');

function migrationsSql() {
  return fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()
    .map(f => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8')).join('\n');
}

function schema(sql = migrationsSql()) {
  return {
    sql,
    tables: [...sql.matchAll(/create table public\.(\w+)/g)].map(m => m[1]),
    functions: [...new Set([...sql.matchAll(/create function public\.(\w+)\(/g)].map(m => m[1]))],
    // Each function's parameter names, so a call names them all and reaches
    // the function itself rather than failing to find it.
    params: Object.fromEntries([...sql.matchAll(/create function public\.(\w+)\(([^)]*)\)/g)]
      .map(m => [m[1], m[2].split(',').map(p => p.trim().split(/\s+/)[0]).filter(Boolean)])),
  };
}

// Postgres's insufficient_privilege: refused for permission, and for nothing else.
const REFUSED = '42501';

/**
 * Whether the publishable (anon) key reaches anything: a read or an insert on
 * each table, a call of each function with every parameter named. Each counts
 * as closed only when refused for permission, so a call that failed for
 * another reason (a missing argument, a bad value) is not mistaken for one
 * refused. Inserts are tried as well as selects: a select on an empty table
 * cannot tell an open policy from a closed one. Resolves to the list of what
 * was not refused, empty when everything was.
 */
async function openToAnon(client, { tables, functions, params } = schema()) {
  const open = [];
  const refused = r => r.error && r.error.code === REFUSED;
  for (const table of tables) {
    if (!refused(await client.from(table).select('*').limit(1))) open.push(`read ${table}`);
    if (!refused(await client.from(table).insert({}))) open.push(`insert into ${table}`);
  }
  for (const fn of functions) {
    const args = Object.fromEntries((params[fn] || []).map(p => [p, null]));
    if (!refused(await client.rpc(fn, args))) open.push(`call ${fn}`);
  }
  return open;
}

module.exports = { schema, migrationsSql, openToAnon, MIGRATIONS };
