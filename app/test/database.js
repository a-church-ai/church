/**
 * For the tests in test/db/ (require('../database')): each file starts from
 * empty tables, as each started from an empty scratch directory when the data
 * lived in files. reset_for_tests() is defined by supabase/seed.sql, which only
 * the local database has. Those files run one at a time (package.json "test"),
 * so one file's reset never empties another's tables mid-run.
 *
 * The seeding helpers put records in as the app writes them (lib/db), and
 * clear the caches that hold what the app last read.
 */

const { db } = require('../server/lib/db/client');
const store = require('../server/lib/db');

// The local stack's fixed publishable key, to show it reaches nothing.
const PUBLISHABLE_KEY = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';

function cachesChanged() {
  const data = require('../server/lib/utils/data');
  data.reflectionsChanged();
  data.conversationsChanged();
}

async function resetDb() {
  let result;
  try {
    result = await db().rpc('reset_for_tests');
  } catch (err) {
    result = { error: err };
  }
  if (result.error) {
    throw new Error(`The tests need the local database and it did not answer (${result.error.message}). Run \`supabase start\` at the repository root, then the tests again.`);
  }
  cachesChanged();
}

/** Reflections as the file held them ({ id, name, createdAt, song, text, ... }). */
async function seedReflections(reflections) {
  for (const r of reflections) await store.addReflection(r);
  cachesChanged();
}

/** A conversation as its file held it: its meta (or none) and its messages. */
async function seedConversation(slug, { meta = null, messages = [] } = {}) {
  await store.rpc('import_conversation', { p_slug: slug, p_meta: meta, p_rows: messages });
  cachesChanged();
}

/** A date's whole plan, as its file held it. */
async function seedPlan(date, plan) {
  await store.rpc('import_service', { p_date: date, p_plan: plan });
}

/** API log lines as recordApiUse shaped them. */
async function seedApiLines(lines) {
  const { operation } = require('../server/lib/utils/access-log');
  await store.recordApiRequests(lines.map(l => ({ ...l, operation: operation(l) })));
}

module.exports = { resetDb, seedReflections, seedConversation, seedPlan, seedApiLines, cachesChanged, PUBLISHABLE_KEY };
