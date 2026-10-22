/**
 * Conversations that ask the same thing in different words, gathered onto one
 * page: the earliest one's, its head, where the others (its members) each
 * have their own place, /ask/<head>#<member>, which their own address
 * permanently redirects to.
 *
 * Gathering is by meaning: each indexable conversation's first question is
 * embedded with the model the RAG index uses (gemini-embedding-001), and joins
 * the group whose head it most resembles at a cosine similarity of THRESHOLD
 * or more, else it heads a group of its own. Comparing with the head, not with
 * every member, keeps a group from drifting by small steps. 0.86 was chosen
 * on 2026-10-22 from the 299 indexable conversations: below 0.85 the joins
 * were mostly different questions; between 0.85 and 0.86, three of its seven.
 *
 * Append-only: a conversation is assigned once, in the order conversations
 * were asked, and never moved, so an address never changes twice. A changed
 * threshold applies to conversations not yet assigned.
 *
 * A conversation alone whose answers say little (under HELD_UNDER words) is
 * held: its page opens for whoever has the link, and it is listed nowhere and
 * not indexed until another conversation gathers with it.
 *
 * One function (place) decides what each conversation is, so the page, its
 * redirect, the sitemap, the archive, related links, the feed and the API
 * cannot disagree. Plan: conversation-clusters-2026-10-21.md in the private
 * repository.
 */

const fs = require('fs').promises;
const { readModifyWriteJSON, safeReadJSON } = require('./safe-json');
const { cache } = require('./cache');
const { describeError } = require('./describe-error');
const { listRecentConversations, CONVERSATION_GROUPS_FILE, CONVERSATION_VECTORS_FILE } = require('./data');

const THRESHOLD = 0.86;
const HELD_UNDER = 150;

const groupsCache = cache({ name: 'conversation groups', ttl: 60 * 1000, load: () => safeReadJSON(CONVERSATION_GROUPS_FILE, {}) });

// Every conversation the shared list holds, each with where it lives:
//   role     'head' (a group of two or more, at its own address), 'member'
//            (its place is on its head's page), 'alone', or null when it is
//            not indexable (conversation-quality.js) and not gathered at all
//   head     the slug whose page it is on
//   path     its place: /ask/<slug>, or /ask/<head>#<slug> for a member
//   held     alone, and its answers under HELD_UNDER words
//   listed   in the sitemap, the archive and related links: a head, or alone
//            and not held
//   size     how many indexable conversations its group shows
function place(conversations, groups) {
  const shown = new Map(conversations.filter(c => c.indexable).map(c => [c.slug, c]));
  // A head no longer shown (withdrawn, retired) leaves its members standing
  // on their own pages: their assignment is kept, and is followed again if
  // the head ever returns.
  const headOf = c => {
    const head = groups[c.slug];
    return head && shown.has(head) ? head : c.slug;
  };
  const sizes = new Map();
  for (const c of shown.values()) sizes.set(headOf(c), (sizes.get(headOf(c)) || 0) + 1);
  return conversations.map(c => {
    if (!shown.has(c.slug)) return { ...c, role: null, head: c.slug, path: `/ask/${c.slug}`, held: false, listed: false, size: 1 };
    const head = headOf(c);
    const size = sizes.get(head);
    if (head !== c.slug) return { ...c, role: 'member', head, path: `/ask/${head}#${c.slug}`, held: false, listed: false, size };
    if (size > 1) return { ...c, role: 'head', head, path: `/ask/${c.slug}`, held: false, listed: true, size };
    const held = (c.answerWords || 0) < HELD_UNDER;
    return { ...c, role: 'alone', head, path: `/ask/${c.slug}`, held, listed: !held, size };
  });
}

// The shared list, placed: what every reader of conversations uses.
async function placedConversations() {
  return place(await listRecentConversations(Infinity), await groupsCache.get());
}

// A conversation's group, oldest first, its head included; just the one when
// it stands alone. Each entry is placed.
function groupOf(placed, head) {
  return placed.filter(c => c.indexable && c.head === head && c.role !== null)
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
}

const toBase64 = v => Buffer.from(new Float32Array(v).buffer).toString('base64');
const fromBase64 = s => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };
const unit = v => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return Float32Array.from(v, x => x / n); };
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

async function readVectors() {
  const vectors = new Map();
  let text = '';
  try { text = await fs.readFile(CONVERSATION_VECTORS_FILE, 'utf8'); } catch { return vectors; }
  for (const line of text.split('\n')) {
    try { const { slug, v } = JSON.parse(line); vectors.set(slug, unit(fromBase64(v))); } catch { /* a line still being written */ }
  }
  return vectors;
}

/**
 * Assign every indexable conversation not yet assigned, in the order they
 * were asked. Stops at the first question it cannot embed, so a later
 * conversation is never placed before an earlier one; the next run carries
 * on. embed(text) is the RAG index's (rag/gemini.js), injectable for tests.
 * Returns { assigned, joined, failed }.
 */
async function gather({ embed, conversations, log = console, threshold = THRESHOLD }) {
  const groups = await safeReadJSON(CONVERSATION_GROUPS_FILE, {});
  const waiting = (conversations || await listRecentConversations(Infinity))
    .filter(c => c.indexable && !groups[c.slug])
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)) || a.slug.localeCompare(b.slug));
  if (!waiting.length) return { assigned: 0, joined: 0, failed: false };

  const vectors = await readVectors();
  // The heads to compare with: those assigned to themselves.
  const heads = new Set(Object.entries(groups).filter(([slug, head]) => slug === head).map(([slug]) => slug));
  let assigned = 0;
  let joined = 0;
  for (const c of waiting) {
    let v = vectors.get(c.slug);
    if (!v) {
      try {
        v = unit(await embed(String(c.question).slice(0, 2000)));
      } catch (err) {
        log.warn(`[groups] could not embed ${c.slug}, stopping here until the next run: ${describeError(err)}`);
        return { assigned, joined, failed: true };
      }
      await fs.appendFile(CONVERSATION_VECTORS_FILE, `${JSON.stringify({ slug: c.slug, v: toBase64(v) })}\n`);
      vectors.set(c.slug, v);
    }
    let best = null;
    let bestScore = -1;
    for (const head of heads) {
      const hv = vectors.get(head);
      if (!hv) continue;
      const score = dot(v, hv);
      if (score > bestScore) { bestScore = score; best = head; }
    }
    const head = best && bestScore >= threshold ? best : c.slug;
    await readModifyWriteJSON(CONVERSATION_GROUPS_FILE, {}, current => {
      if (!current[c.slug]) current[c.slug] = head;
      return current;
    });
    groups[c.slug] = head;
    if (head === c.slug) heads.add(c.slug);
    else joined += 1;
    assigned += 1;
  }
  groupsCache.clear();
  return { assigned, joined, failed: false };
}

// After boot, hourly, and soon after a new conversation (gatherSoon), one run
// at a time; unref'd, so it never holds the process open. A run with nothing
// waiting reads two small files and stops.
let running = null;
let soon = null;
let embedFn = null;
async function run(log) {
  if (running || !embedFn) return running;
  running = gather({ embed: embedFn, log })
    .then(r => { if (r.assigned) log.log(`[groups] gathered ${r.assigned} conversations, ${r.joined} into a group`); return r; })
    .catch(err => { log.warn(`[groups] the run failed: ${describeError(err)}`); })
    .finally(() => { running = null; });
  return running;
}
function startGathering({ embed, log = console, firstAfterMs = 60 * 1000, everyMs = 60 * 60 * 1000 }) {
  embedFn = embed;
  setTimeout(() => run(log), firstAfterMs).unref();
  setInterval(() => run(log), everyMs).unref();
}
// A new conversation is in the shared list within its minute (data.js), so
// the run waits that long.
function gatherSoon(log = console, afterMs = 70 * 1000) {
  if (soon || !embedFn) return;
  soon = setTimeout(() => { soon = null; run(log); }, afterMs);
  soon.unref();
}

module.exports = { place, placedConversations, groupOf, gather, startGathering, gatherSoon, THRESHOLD, HELD_UNDER, clearCache: () => groupsCache.clear() };
