/**
 * What the database promises, held against the migrations as they are
 * (supabase/migrations/), so a table or function added later is held too:
 *
 * - The publishable (anon) key can neither read nor add to any table, nor
 *   call any function. Inserts are tried as well as selects: a select on an
 *   empty table cannot tell an open policy from a closed one (satchitananda's
 *   lesson).
 * - No table has a policy: only the server's secret key reaches anything.
 * - Only the API log keeps an address, and nothing joins a page visit's
 *   visitor id to anything a visitor wrote.
 * - A read past Supabase's silent 1,000-row cap returns every row.
 */

const test = require('node:test');
const assert = require('node:assert');
const { createClient } = require('@supabase/supabase-js');

const store = require('../../server/lib/db');
const { resetDb, PUBLISHABLE_KEY } = require('../database');

const { schema, openToAnon } = require('../../server/lib/db/schema');

const { sql: SQL, tables: TABLES, functions: FUNCTIONS } = schema();
// Each table's own lines, from its create statement to the closing ");".
const tableBody = name => SQL.match(new RegExp(`create table public\\.${name} \\(([\\s\\S]*?)\\n\\);`))[1];

const anon = createClient(process.env.SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

test.before(resetDb);

test('the migrations name the tables and functions this file holds', () => {
  assert.ok(TABLES.length >= 20, TABLES.join(', '));
  assert.ok(FUNCTIONS.length >= 30, FUNCTIONS.join(', '));
});

test('the publishable key can read no table, add to none, and call no function', async () => {
  assert.deepStrictEqual(await openToAnon(anon), [], 'what the publishable key reaches');
});

test('no table has a policy, and every one has row level security on', () => {
  assert.doesNotMatch(SQL, /create policy/i, 'only the secret key reaches anything');
  for (const table of TABLES) assert.match(SQL, new RegExp(`alter table public\\.${table} enable row level security`), table);
});

test('only the API log keeps an address, and nothing joins a visitor id to what a visitor wrote', () => {
  for (const table of TABLES) {
    const body = tableBody(table);
    if (table !== 'api_requests') assert.doesNotMatch(body, /^\s*(ip|address)\b/m, `${table} keeps an address`);
    if (table !== 'page_visits') assert.doesNotMatch(body, /^\s*visitor\b/m, `${table} keeps a visitor id`);
  }
});

test('a read past the 1,000-row cap returns every row', async () => {
  await resetDb();
  const base = Date.parse('2026-01-01T00:00:00Z');
  const rows = Array.from({ length: 1001 }, (_, i) => ({ id: `cap-${i}`, name: `Reader ${i % 7}`, text: `Reflection ${i}.`, song: 'soul-currents', createdAt: new Date(base + i * 1000).toISOString() }));
  for (let i = 0; i < rows.length; i += 100) await Promise.all(rows.slice(i, i + 100).map(r => store.addReflection(r)));
  const all = await store.allReflections();
  assert.strictEqual(all.length, 1001);
  assert.strictEqual(all[1000].id, 'cap-1000', 'in order, the last one too');
});
