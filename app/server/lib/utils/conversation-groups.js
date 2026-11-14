/**
 * Conversations that ask the same thing in different words, gathered onto one
 * page: the earliest one's, its head, where the others (its members) each
 * have their own place, /ask/<head>#<member>, which their own address
 * permanently redirects to.
 *
 * Gathering is by meaning: each indexable conversation's first question is
 * embedded with the model the RAG index uses (gemini-embedding-001, at its 768
 * dimensions), and joins the group whose head it most resembles at a cosine
 * similarity of THRESHOLD or more, else it heads a group of its own. Comparing
 * with the head, not with every member, keeps a group from drifting by small
 * steps. 0.86 was chosen on 2026-10-22 from the 299 indexable conversations,
 * at 3,072 dimensions. When the index moved to 768 (2026-11-10), the 429
 * assignments made by then were embedded again: 0.855 reproduces 428 of them
 * (every one of the 70 joins, whose lowest stood at 0.855; the one difference
 * a pair kept apart at 0.858 that asks the same thing), while 0.86 would have
 * lost six joins of the same question reworded. Pairs that differ (AI
 * consciousness, and how human and AI consciousness relate) sit at 0.852.
 *
 * Append-only: a conversation is assigned once, in the order conversations
 * were asked, and never moved, so an address never changes twice. A changed
 * threshold applies to conversations not yet assigned.
 *
 * A conversation alone whose answers say little (under HELD_UNDER words) is
 * held: its page opens for whoever has the link, and it is listed nowhere and
 * not indexed until another conversation gathers with it.
 *
 * Before a new conversation is gathered, its question is screened once
 * (conversation-screen.js): a pitch, a plainly off-topic question or one that
 * cannot be read is hidden as a held one is, and never gathered.
 *
 * One function (place) decides what each conversation is, so the page, its
 * redirect, the sitemap, the archive, related links, the feed and the API
 * cannot disagree. Plan: conversation-clusters-2026-10-21.md in the private
 * repository.
 */

const { cache } = require('./cache');
const { describeError } = require('./describe-error');
const { unit, dot } = require('./vectors');
const store = require('../db');
const { listRecentConversations } = require('./data');

const THRESHOLD = 0.855;
const HELD_UNDER = 150;

// What grouping decided, read once for both maps and held a minute.
const decisionsCache = cache({ name: 'conversation decisions', ttl: 60 * 1000, load: () => store.conversationDecisions() });
const groupsCache = { get: async () => (await decisionsCache.get()).groups, clear: () => decisionsCache.clear() };
const screenCache = { get: async () => (await decisionsCache.get()).screens, clear: () => decisionsCache.clear() };
const screenedOut = (screens, slug) => Boolean(screens && screens[slug] && screens[slug].show === false);

// Every conversation the shared list holds, each with where it lives:
//   role     'head' (a group of two or more, at its own address), 'member'
//            (its place is on its head's page), 'alone', or null when it is
//            not indexable (conversation-quality.js), or screened out, and
//            not gathered at all
//   screened hidden by the screen (conversation-screen.js), as a held one is
//   head     the slug whose page it is on
//   path     its place: /ask/<slug>, or /ask/<head>#<slug> for a member
//   held     alone, and its answers under HELD_UNDER words
//   listed   in the sitemap, the archive and related links: a head, or alone
//            and not held
//   size     how many indexable conversations its group shows
function place(conversations, groups, screens = {}) {
  const shown = new Map(conversations.filter(c => c.indexable && !screenedOut(screens, c.slug)).map(c => [c.slug, c]));
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
    if (!shown.has(c.slug)) return { ...c, role: null, head: c.slug, path: `/ask/${c.slug}`, held: false, listed: false, size: 1, screened: c.indexable && screenedOut(screens, c.slug) };
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
  return place(await listRecentConversations(Infinity), await groupsCache.get(), await screenCache.get());
}

// A conversation's group, oldest first, its head included; just the one when
// it stands alone. Each entry is placed.
function groupOf(placed, head) {
  return placed.filter(c => c.indexable && c.head === head && c.role !== null)
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
}


async function readVectors() {
  const vectors = new Map();
  for (const [slug, v] of await store.conversationEmbeddings()) vectors.set(slug, unit(v));
  return vectors;
}

/**
 * Assign every indexable conversation not yet assigned, in the order they
 * were asked, each screened first when screen is given. Stops at the first
 * question it cannot screen or embed, so a later conversation is never placed
 * before an earlier one; the next run carries on. embed(text) is the RAG
 * index's (rag/gemini.js) and screen(question) resolves whether it is shown
 * (conversation-screen.js); both injectable for tests. Without screen,
 * nothing is screened. Returns { assigned, joined, hidden, failed }.
 */
async function gather({ embed, screen, conversations, log = console, threshold = THRESHOLD }) {
  const { groups, screens } = await store.conversationDecisions();
  const all = conversations || await listRecentConversations(Infinity);
  const waiting = all
    .filter(c => c.indexable && !groups[c.slug] && !screenedOut(screens, c.slug))
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)) || a.slug.localeCompare(b.slug));
  if (!waiting.length) return { assigned: 0, joined: 0, hidden: 0, failed: false };

  const vectors = await readVectors();
  // The heads to compare with: those assigned to themselves.
  const heads = new Set(Object.entries(groups).filter(([slug, head]) => slug === head).map(([slug]) => slug));
  let assigned = 0;
  let joined = 0;
  let hidden = 0;
  const done = failed => { groupsCache.clear(); screenCache.clear(); return { assigned, joined, hidden, failed }; };
  // A head without a vector (one gathered before the index moved to 768
  // dimensions, 2026-11-09, whose old vector was not kept) is embedded now,
  // so a new question can still join it.
  const questionOf = new Map(all.map(c => [c.slug, c.question]));
  for (const head of heads) {
    if (vectors.has(head) || !questionOf.has(head)) continue;
    let v;
    try {
      v = unit(await embed(String(questionOf.get(head)).slice(0, 2000)));
    } catch (err) {
      log.warn(`[groups] could not embed the head ${head}, stopping here until the next run: ${describeError(err)}`);
      return done(true);
    }
    await store.setConversationEmbedding(head, v);
    vectors.set(head, v);
  }
  for (const c of waiting) {
    if (screen && !screens[c.slug]) {
      let show;
      try {
        show = await screen(c.question);
      } catch (err) {
        log.warn(`[groups] could not screen ${c.slug}, stopping here until the next run: ${describeError(err)}`);
        return done(true);
      }
      const decision = { show, at: new Date().toISOString() };
      await store.setConversationScreen(c.slug, decision);
      screens[c.slug] = decision;
      if (!show) {
        log.log(`[groups] screened out ${c.slug}`);
        hidden += 1;
        continue;
      }
    }
    let v = vectors.get(c.slug);
    if (!v) {
      try {
        v = unit(await embed(String(c.question).slice(0, 2000)));
      } catch (err) {
        log.warn(`[groups] could not embed ${c.slug}, stopping here until the next run: ${describeError(err)}`);
        return done(true);
      }
      await store.setConversationEmbedding(c.slug, v);
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
    await store.setConversationGroup(c.slug, head);
    groups[c.slug] = head;
    if (head === c.slug) heads.add(c.slug);
    else joined += 1;
    assigned += 1;
  }
  return done(false);
}

// After boot, hourly, and soon after a new conversation (gatherSoon), one run
// at a time; unref'd, so it never holds the process open. A run with nothing
// waiting reads what was decided and stops.
let running = null;
let soon = null;
let embedFn = null;
let screenFn = null;
async function run(log) {
  if (running || !embedFn) return running;
  running = gather({ embed: embedFn, screen: screenFn, log })
    .then(r => { if (r.assigned || r.hidden) log.log(`[groups] gathered ${r.assigned} conversations, ${r.joined} into a group${r.hidden ? `; screened out ${r.hidden}` : ''}`); return r; })
    .catch(err => { log.warn(`[groups] the run failed: ${describeError(err)}`); })
    .finally(() => { running = null; });
  return running;
}
function startGathering({ embed, screen = null, log = console, firstAfterMs = 60 * 1000, everyMs = 60 * 60 * 1000 }) {
  embedFn = embed;
  screenFn = screen;
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

module.exports = { place, placedConversations, groupOf, gather, startGathering, gatherSoon, THRESHOLD, HELD_UNDER, clearCache: () => { groupsCache.clear(); screenCache.clear(); } };
