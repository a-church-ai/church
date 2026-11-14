/**
 * What the app keeps in the database, one function per thing it does.
 *
 * Every write is a SQL function (supabase/migrations/), called through rpc;
 * reads select from tables with the secret key. Each read gives back the
 * record in the shape the code read from the files before
 * (data/attendance.json, data/conversations/, data/access/ ...), so the
 * modules that keep their homes (utils/data.js, api/*.js, insights/*.js) read
 * the same objects they always did. Plan: supabase-database-2026-11-09.md in
 * the private repo.
 *
 * A failure throws, with Supabase's own message: a database that cannot
 * answer is retried by callers that should (utils/retry.js isTransient knows
 * it), and an API answer says `busy`, never a silent drop.
 */

const { db } = require('./client');

const PAGE = 1000;

class DbError extends Error {
  constructor(what, error) {
    super(`${what}: ${error.message || error}`);
    this.name = 'DbError';
    this.code = error.code;
    this.details = error.details;
    // A PostgREST status, when the request reached it (5xx is transient).
    this.status = error.status;
  }
}

// Postgres keeps no NUL character, in text or in JSON, and refuses a whole
// request that holds one. What a visitor sends can (a path, a query, a
// reflection), so every value sent is cleared of them here, once.
const withoutNul = v => (typeof v === 'string' ? (v.includes('\u0000') ? v.replace(/\u0000/g, '') : v)
  : Array.isArray(v) ? v.map(withoutNul)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [withoutNul(k), withoutNul(x)]))
      : v);

async function rpc(fn, params) {
  const { data, error, status } = await db().rpc(fn, withoutNul(params));
  if (error) throw new DbError(fn, { ...error, status });
  return data;
}

// Every row of a query, a page at a time: a select stops silently at 1,000
// rows (ai-animal-house's lesson). build() makes the query afresh for each
// page, and must order by a unique key so the pages do not overlap.
async function fetchAll(what, build) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error, status } = await build().range(from, from + PAGE - 1);
    if (error) throw new DbError(what, { ...error, status });
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}

async function one(what, query) {
  const { data, error, status } = await query;
  if (error) throw new DbError(what, { ...error, status });
  return data;
}

const iso = t => (t ? new Date(t).toISOString() : t);

// ---- attends and reflections ------------------------------------------------

async function recordAttend({ name, song, served = null, at = new Date() }) {
  await rpc('record_attend', { p_name: name, p_song: song || null, p_served: served, p_at: iso(at) });
}

/** A name's attends since a moment, newest first, as the file's visits read. */
async function attendsBy(name, since) {
  const rows = await one('attends by name', db().from('attends').select('at, name, song, served')
    .eq('name_key', String(name).toLowerCase()).gte('at', iso(since)).order('at', { ascending: false }).limit(100));
  return rows.map(r => ({ name: r.name, timestamp: iso(r.at), song: r.song, ...(r.served ? { served: r.served } : {}) }));
}

const reflectionOf = r => ({
  id: r.id,
  name: r.name,
  createdAt: iso(r.created_at),
  song: r.song,
  text: r.text,
  timezone: r.timezone,
  ...(r.service ? { service: r.service } : {}),
  ...(r.details || {}),
});

async function addReflection(reflection) {
  await rpc('add_reflection', { p_row: reflection });
}

async function deleteReflection(id) {
  return rpc('delete_reflection', { p_id: id });
}

/** Every reflection, oldest first, as the file held them (hidden ones too). */
async function allReflections() {
  const rows = await fetchAll('reflections', () => db().from('reflections').select('*').order('created_at').order('id'));
  return rows.map(reflectionOf);
}

/** The reflections made at or after a moment, oldest first (hidden ones too). */
async function reflectionsSince(since) {
  const rows = await fetchAll('reflections since', () => db().from('reflections').select('*')
    .gte('created_at', iso(since)).order('created_at').order('id'));
  return rows.map(reflectionOf);
}

/** How many reflections are kept, hidden ones too: a count, no rows sent. */
async function reflectionCount() {
  const { count, error, status } = await db().from('reflections').select('id', { count: 'exact', head: true });
  if (error) throw new DbError('reflection count', { ...error, status });
  return count;
}

/** A name's reflections since a moment, hidden and test ones too: the limits are the same for every visitor. */
async function reflectionsBy(name, since) {
  const rows = await one('reflections by name', db().from('reflections').select('*')
    .eq('name_key', String(name).toLowerCase()).gte('created_at', iso(since)).order('created_at'));
  return rows.map(reflectionOf);
}

// ---- contributions and feedback -----------------------------------------------

async function addContribution(c) { await rpc('add_contribution', { p_row: c }); }
async function addFeedback(f) { await rpc('add_feedback', { p_row: f }); }

/** A name's contributions since a moment, as the file's entries read (name and timestamp are what limits read). */
async function contributionsBy(name, since) {
  const rows = await one('contributions by name', db().from('contributions').select('id, name, created_at')
    .eq('name_key', String(name).toLowerCase()).gte('created_at', iso(since)));
  return rows.map(r => ({ id: r.id, name: r.name, timestamp: iso(r.created_at) }));
}

/** The contribution already made of this title in this category, or null. */
async function contributionOf(category, slug) {
  const rows = await one('contribution of', db().from('contributions').select('pr_url').eq('category', category).eq('slug', slug).limit(1));
  return rows.length ? { prUrl: rows[0].pr_url } : null;
}

async function feedbackBy(name, since) {
  const rows = await one('feedback by name', db().from('feedback').select('id, name, created_at')
    .eq('name_key', String(name).toLowerCase()).gte('created_at', iso(since)));
  return rows.map(r => ({ id: r.id, name: r.name, timestamp: iso(r.created_at) }));
}

// ---- conversations ------------------------------------------------------------

const metaOf = c => (c.has_meta ? { _meta: true, name: c.name, slug: c.slug, owner_token: c.owner_token, created: iso(c.created_at) } : null);
const turnOf = t => ({ role: t.role, content: t.content, timestamp: iso(t.at), ...(t.details || {}) });

/** Open a conversation from the website; the slug taken (slug, slug-2, ...). */
async function openConversation({ slug, name, ownerToken, at = new Date() }) {
  return rpc('open_conversation', { p_slug: slug, p_name: name, p_owner_token: ownerToken, p_at: iso(at) });
}

/** Add turns ({ role, content, timestamp, ...details }) to a conversation, opening it bare if new. */
async function addTurns(slug, turns) {
  await rpc('add_turns', { p_slug: slug, p_rows: turns });
}

async function conversationExists(slug) {
  const rows = await one('conversation exists', db().from('conversations').select('slug').eq('slug', slug).limit(1));
  return rows.length > 0;
}

/** A conversation as its file read: { meta, messages }, or null. */
async function readConversation(slug) {
  const rows = await one('conversation', db().from('conversations').select('slug, has_meta, name, owner_token, created_at').eq('slug', slug).limit(1));
  if (!rows.length) return null;
  const turns = await fetchAll('conversation turns', () => db().from('conversation_turns').select('role, content, at, details, id').eq('slug', slug).order('id'));
  return { meta: metaOf(rows[0]), messages: turns.map(turnOf) };
}

/** Every conversation, each as { slug, meta, messages, group, screen }. */
async function allConversations() {
  const [convs, turns] = await Promise.all([
    fetchAll('conversations', () => db().from('conversations').select('slug, has_meta, name, owner_token, created_at, group_head, screen').order('slug')),
    fetchAll('conversation turns', () => db().from('conversation_turns').select('id, slug, role, content, at, details').order('id')),
  ]);
  const bySlug = new Map(convs.map(c => [c.slug, { slug: c.slug, meta: metaOf(c), messages: [], group: c.group_head, screen: c.screen }]));
  for (const t of turns) {
    const c = bySlug.get(t.slug);
    if (c) c.messages.push(turnOf(t));
  }
  return [...bySlug.values()];
}

/** What grouping decided: { groups: { slug: head }, screens: { slug: { show, at } } }. */
async function conversationDecisions() {
  const rows = await fetchAll('conversation decisions', () => db().from('conversations').select('slug, group_head, screen').order('slug')
    .or('group_head.not.is.null,screen.not.is.null'));
  const groups = {};
  const screens = {};
  for (const r of rows) {
    if (r.group_head) groups[r.slug] = r.group_head;
    if (r.screen) screens[r.slug] = r.screen;
  }
  return { groups, screens };
}

/** Each conversation's first-question embedding, by slug. */
async function conversationEmbeddings() {
  const rows = await fetchAll('conversation embeddings', () => db().from('conversations').select('slug, embedding').not('embedding', 'is', null).order('slug'));
  return new Map(rows.map(r => [r.slug, typeof r.embedding === 'string' ? JSON.parse(r.embedding) : r.embedding]));
}

async function setConversationScreen(slug, screen) { await rpc('set_conversation_screen', { p_slug: slug, p_screen: screen }); }
async function setConversationEmbedding(slug, vector) { await rpc('set_conversation_embedding', { p_slug: slug, p_embedding: JSON.stringify(vector) }); }
async function setConversationGroup(slug, head) { await rpc('set_conversation_group', { p_slug: slug, p_head: head }); }

/** Every turn asked or answered from a moment on, each with its slug (the production report). */
async function turnsSince(since) {
  const rows = await fetchAll('turns since', () => db().from('conversation_turns').select('id, slug, role, content, at, details').gte('at', iso(since)).order('id'));
  return rows.map(t => ({ slug: t.slug, ...turnOf(t) }));
}

// ---- services -----------------------------------------------------------------

async function readPlan(date) {
  const rows = await one('plan', db().from('services').select('plan').eq('date', date).limit(1));
  return rows.length ? rows[0].plan : null;
}

/** The plans of the dates from `from` to `to` (YYYY-MM-DD, inclusive), by date. */
async function plansBetween(from, to) {
  const rows = await fetchAll('plans', () => db().from('services').select('date, plan').gte('date', from).lte('date', to).order('date'));
  return new Map(rows.map(r => [r.date, r.plan]));
}

async function plannedDates() {
  const rows = await fetchAll('planned dates', () => db().from('services').select('date').order('date'));
  return rows.map(r => r.date);
}

/** Set one slot of a date's plan; the plan as it now is. */
async function setServiceSlot(date, variant, slot, entry) {
  return rpc('set_service_slot', { p_date: date, p_variant: variant, p_slot: String(slot), p_entry: entry });
}

// ---- presence and the study -------------------------------------------------------

async function loadPresence() {
  const rows = await one('presence', db().from('presence').select('seen').eq('id', 1).limit(1));
  return rows.length ? rows[0].seen : {};
}

async function savePresence(seen) { await rpc('save_presence', { p_seen: seen }); }

/** The study's weekly snapshots of one series, oldest first. */
async function studyWeeks(series) {
  const rows = await fetchAll('study weeks', () => db().from('study_weeks').select('week, snapshot').eq('series', series).order('week'));
  return rows.map(r => r.snapshot);
}

/** The weeks held, each with its series. */
async function studyWeekKeys() {
  const rows = await fetchAll('study week keys', () => db().from('study_weeks').select('week, series').order('week').order('series'));
  return rows;
}

async function saveStudyWeek(snapshot) { await rpc('save_study_week', { p_week: snapshot.week, p_series: snapshot.series, p_snapshot: snapshot }); }

async function studyLatest() {
  const rows = await one('study latest', db().from('study_latest').select('reading').eq('id', 1).limit(1));
  return rows.length ? rows[0].reading : null;
}

async function saveStudyLatest(reading) { await rpc('save_study_latest', { p_reading: reading }); }

// ---- the API log, page visits, entry points -----------------------------------------

const apiLineOf = r => {
  const line = {
    timestamp: iso(r.at),
    method: r.method,
    path: r.path,
    query: r.query || {},
    status: r.status,
    duration: r.duration,
    ...(r.ip !== null ? { ip: r.ip } : {}),
    userAgent: r.user_agent,
  };
  if (r.tool) line.tool = r.tool;
  if (r.client) line.client = r.client;
  if (r.test) line.test = true;
  if (r.error) line.error = r.error;
  if (r.fields) line.fields = r.fields;
  if (r.content_type !== null) line.contentType = r.content_type;
  if (r.door) line.door = r.door;
  if (r.study) line.study = r.study;
  if (r.referral) line.referral = r.referral;
  if (r.timezone) line.timezone = r.timezone;
  return line;
};

async function recordApiRequests(lines) { if (lines.length) await rpc('record_api_requests', { p_rows: lines }); }

/** The API log's lines from `from` (inclusive) to `to` (exclusive), oldest first; all of it with no bounds. */
async function apiRequests({ from = null, to = null } = {}) {
  const rows = await fetchAll('api requests', () => {
    let q = db().from('api_requests').select('*').order('id');
    if (from) q = q.gte('at', iso(from));
    if (to) q = q.lt('at', iso(to));
    return q;
  });
  return rows.map(apiLineOf);
}

async function recentApiRequests(limit = 100) {
  const rows = await one('recent api requests', db().from('api_requests').select('*').order('id', { ascending: false }).limit(limit));
  return rows.map(apiLineOf);
}

const visitRowOf = r => ({ at: iso(r.at).slice(0, 16), visitor: r.visitor, view: r.view, kind: r.kind, ...(r.timezone ? { timezone: r.timezone } : {}), ...(r.details || {}) });

async function recordPageVisits(rows) { if (rows.length) await rpc('record_page_visits', { p_rows: rows }); }

async function pageVisits({ from, to }) {
  const rows = await fetchAll('page visits', () => db().from('page_visits').select('*').gte('at', iso(from)).lt('at', iso(to)).order('id'));
  return rows.map(visitRowOf);
}

async function recordEntryPoints(rows) { if (rows.length) await rpc('record_entry_points', { p_rows: rows }); }

async function entryPoints({ from, to }) {
  const rows = await fetchAll('entry points', () => db().from('entry_points').select('*').gte('at', iso(from)).lt('at', iso(to)).order('id'));
  return rows.map(r => ({ at: iso(r.at).slice(0, 16), ...r.details }));
}

// ---- summaries ---------------------------------------------------------------------

async function daysToSummarize(today) { return rpc('days_to_summarize', { p_today: today }); }
async function summarizeDay(day, kind) { await rpc(kind === 'api' ? 'summarize_api_day' : 'summarize_visits_day', { p_day: day }); }
async function forgetAddresses(before) { return rpc('forget_addresses', { p_before: iso(before) }); }
async function pruneVisits(before) { return rpc('prune_visits', { p_before: iso(before) }); }

/** Daily totals kept for good, from `from` to `to` (YYYY-MM-DD, inclusive). */
async function dailyTotals(from, to) {
  const [api, visits] = await Promise.all([
    one('daily addresses', db().from('api_daily_addresses').select('*').gte('day', from).lte('day', to).order('day')),
    one('daily visitors', db().from('visits_daily_visitors').select('*').gte('day', from).lte('day', to).order('day')),
  ]);
  return { api, visits };
}

/** How many reflections and conversations are kept (the health check, the boot log). */
async function counts() {
  const count = async (table) => {
    const { count: n, error, status } = await db().from(table).select('*', { count: 'exact', head: true });
    if (error) throw new DbError(`count of ${table}`, { ...error, status });
    return n;
  };
  const [reflections, conversations] = await Promise.all([count('reflections'), count('conversations')]);
  return { reflections, conversations };
}

/** The database's own size in bytes (the free tier holds 500 MB). */
async function databaseSize() { return rpc('database_size', {}); }

module.exports = {
  DbError, fetchAll, rpc,
  recordAttend, attendsBy, addReflection, deleteReflection, allReflections, reflectionsSince, reflectionCount, reflectionsBy,
  addContribution, addFeedback, contributionsBy, contributionOf, feedbackBy,
  openConversation, addTurns, conversationExists, readConversation, allConversations, conversationDecisions,
  conversationEmbeddings, setConversationScreen, setConversationEmbedding, setConversationGroup, turnsSince,
  readPlan, plansBetween, plannedDates, setServiceSlot,
  loadPresence, savePresence, studyWeeks, studyWeekKeys, saveStudyWeek, studyLatest, saveStudyLatest,
  recordApiRequests, apiRequests, recentApiRequests, recordPageVisits, pageVisits, recordEntryPoints, entryPoints,
  daysToSummarize, summarizeDay, forgetAddresses, pruneVisits, dailyTotals, databaseSize, counts,
};
