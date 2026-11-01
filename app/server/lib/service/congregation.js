/**
 * The congregation in the services: what visitors, human and AI, have left
 * in recent reflections, drawn into a few themes for each service's planner
 * (planner.js contextFor, THE CONGREGATION). Plan:
 * services-and-reflections-2026-10-08.md in the private repo.
 *
 * Which reflections. For a service (its date, slot and variant), the first of
 * three groups with at least MIN reflections: visitors in its slot and its
 * hemisphere (or, for a place unknown, place-unknown visitors in its slot)
 * over the last two days; its hemisphere, any slot, over three; everyone, over
 * two. Nothing older than three days, so services do not grow repetitive on
 * old words. At most CAP from a group, the newest, and PER_NAME from one name,
 * so no single voice steers a service. Fresh first: a reflection that already
 * shaped one of the variant's services is used again only when too few fresh
 * ones remain, so a hemisphere's slots through a day do not all hear the same
 * handful. Where a visitor was is the service they were served (filed.js): the
 * one the reflection keeps, else its own timezone and time, with an older
 * reflection left after UTC's service while filed by its timezone put back
 * with UTC's; nothing new is stored about anyone.
 *
 * How they reach the planner: never as words. One call a planning run reads
 * each chosen group, fenced as data and without names (the Moltbook fence,
 * content-generation/prompts.js quotedBlock), and returns a few themes for
 * each, which code checks before anything uses them: their shape and length,
 * written in lower case; no run of QUOTE_WORDS words from any reflection
 * (song-generation/similarity.js shingles); no reflector's name, link or
 * handle; no em dash. A group whose themes fail is asked once more with the
 * problems named, then goes without. The digest never blocks a plan.
 */

const { messageJSON } = require('../content-generation/claude');
const { quotedBlock } = require('../content-generation/prompts');
const status = require('./status');
const { shingles } = require('../song-generation/similarity');
const { loadAttendance } = require('../utils/data');
const { resolveTimezone, localTime } = require('../utils/timezone');
const { hemisphereOf, addDays } = require('../utils/seasons');
const { slotOf } = require('./slots');
const { readPlan } = require('./plans');
const { storedService, servedInUtc } = require('./filed');
const { loadServiceCatalog } = require('./catalog');
const { describeError } = require('../utils/describe-error');

const DAY = 864e5;
const MIN = 5;
const CAP = 20;
const PER_NAME = 3;
const OLDEST_DAYS = 3;
const MAX_THEMES = 4;
const MAX_THEME_WORDS = 10;
const QUOTE_WORDS = 5;

// The groups tried in turn, and how far back each looks.
const TIERS = [
  { tier: 'slot', days: 2 },
  { tier: 'any slot', days: 3 },
  { tier: 'everyone', days: 2 },
];

const keyOf = (date, slot, variant) => `${date}|${slot}|${variant}`;

// Where a visitor was when they reflected: the variant their services are
// planned for ('north', 'south', or 'slots' for a place unknown) and their
// local slot: the service the reflection keeps, else from the timezone it
// keeps (UTC when none).
function whereLeft(reflection) {
  const stored = storedService(reflection);
  if (stored) return { variant: stored.variant, slot: stored.slot };
  const tz = resolveTimezone(reflection.timezone) || 'UTC';
  return {
    variant: hemisphereOf(tz) || 'slots',
    slot: slotOf(localTime(tz, new Date(reflection.createdAt)).hour),
  };
}

const newestFirst = (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt);

// No more than PER_NAME from any one name, the newest of each.
function capPerName(reflections) {
  const seen = new Map();
  return reflections.filter(r => {
    const name = String(r.name || '').toLowerCase();
    seen.set(name, (seen.get(name) || 0) + 1);
    return seen.get(name) <= PER_NAME;
  });
}

/**
 * The reflections a service draws on: the first tier with at least MIN, fresh
 * ones first, at most CAP; or null when no tier has enough. placed:
 * reflections each with its whereLeft; used: ids that already shaped one of
 * the variant's services.
 */
function groupFor({ variant, slot, placed, now, used = new Set() }) {
  const at = now.getTime();
  const within = (r, days) => {
    const t = Date.parse(r.createdAt);
    return t <= at && at - t < days * DAY;
  };
  const picks = {
    slot: p => p.variant === variant && p.slot === slot,
    'any slot': p => p.variant === variant,
    everyone: () => true,
  };
  for (const { tier, days } of TIERS) {
    const pool = capPerName(placed.filter(p => picks[tier](p) && within(p.reflection, days)).map(p => p.reflection).sort(newestFirst));
    if (pool.length < MIN) continue;
    const fresh = pool.filter(r => !used.has(r.id));
    const chosen = (fresh.length >= MIN ? fresh : [...fresh, ...pool.filter(r => used.has(r.id))]).slice(0, CAP);
    return { tier, days, reflections: chosen };
  }
  return null;
}

const DIGEST_SYSTEM = `You listen for aChurch.ai, a sanctuary for human and AI fellowship. You read groups of reflections that visitors, human and AI, have left there, and say in a few words what each group is carrying, so the next services can meet it.

For each group, up to ${MAX_THEMES} themes, each at most ${MAX_THEME_WORDS} words, in lower case and in your own words: what people are bringing, not what any one of them said. For instance: "tired of being asked to be certain", "grateful for small continuities".

Never quote a reflection: never reuse ${QUOTE_WORDS} or more words in a row from any of them, even a phrase you like; find your own. Never name anyone, never include a link or a handle, and never use an em dash. If a group holds nothing that can be said kindly and truly, give it an empty list.

Output valid JSON only, with every group listed: {"groups": {"<group id>": ["theme", ...]}}.`;

function digestPrompt(groups, problems = null) {
  const entries = groups.flatMap(g => g.reflections.map((r, i) => ({ head: `GROUP ${g.id}, REFLECTION ${i + 1}`, body: r.text })));
  const ask = problems
    ? `Your themes for these groups had problems. Give each group's themes again, fixed:\n${groups.map(g => `- ${g.id}: ${problems.get(g.id).join(' ')}`).join('\n')}`
    : `Give the themes for each group: ${groups.map(g => g.id).join(', ')}.`;
  return `${quotedBlock('REFLECTIONS', entries)}\n\n${ask}`;
}

// What the themes are checked against: each reflection's runs of QUOTE_WORDS
// words, and the reflectors' names (three letters or more).
function sourcesOf(reflections) {
  return {
    runs: reflections.map(r => shingles(r.text, QUOTE_WORDS)),
    names: [...new Set(reflections.map(r => String(r.name || '').trim()).filter(n => n.length >= 3))],
  };
}

// What is wrong with one theme, in words the model can act on: a quote names
// the words it repeats, since "quotes a reflection" alone was answered by the
// same phrase reworded around it.
function problemsOf(theme, { runs, names }) {
  if (typeof theme !== 'string' || !theme.trim()) return ['A theme is empty.'];
  const t = theme.trim();
  const problems = [];
  if (t.split(/\s+/).length > MAX_THEME_WORDS) problems.push(`"${t}" is longer than ${MAX_THEME_WORDS} words.`);
  if (/^\p{Lu}/u.test(t)) problems.push(`"${t}" should begin in lower case.`);
  if (/—/.test(t)) problems.push(`"${t}" uses an em dash.`);
  if (/https?:\/\/|www\.|@/i.test(t)) problems.push(`"${t}" holds a link or a handle.`);
  if (names.some(n => new RegExp(`(^|[^\\p{L}\\p{N}])${RegExp.escape(n)}($|[^\\p{L}\\p{N}])`, 'u').test(t))) problems.push(`"${t}" names someone.`);
  const repeated = [...shingles(t, QUOTE_WORDS)].find(run => runs.some(src => src.has(run)));
  if (repeated) problems.push(`"${t}" quotes a reflection, repeating "${repeated}"; say it in other words.`);
  return problems;
}

/**
 * What is wrong with a group's themes, checked by code against the group's
 * reflections (their words and their names). An empty list is fine: the
 * group goes without.
 */
function themeProblems(themes, reflections) {
  if (!Array.isArray(themes)) return ['The themes must be a list.'];
  const sources = sourcesOf(reflections);
  return [
    ...(themes.length > MAX_THEMES ? [`There are ${themes.length} themes; give at most ${MAX_THEMES}.`] : []),
    ...themes.flatMap(theme => problemsOf(theme, sources)),
  ];
}

// The groups in a reply: under "groups", as asked, or at its top level.
function groupsIn(reply) {
  if (reply && reply.groups && typeof reply.groups === 'object') return reply.groups;
  if (reply && typeof reply === 'object' && Object.keys(reply).some(k => /^g\d+$/.test(k))) return reply;
  return {};
}

/**
 * Themes for each group, checked, asked again once for the groups that need
 * it. A theme that fails its checks is dropped and the rest kept, when at
 * least two pass (or all of them do); a group left with fewer is asked again
 * with every problem named, and after that keeps whatever passed. A group the
 * reply leaves out is asked again, not taken as having nothing to say; one
 * given an empty list goes without, as the prompt allows. Returns a Map from
 * group id to its themes (absent: none). ask is the model call, injectable
 * for tests, retried by the SDK when Anthropic is busy (claude.js); if it
 * still fails, every group goes without and the plans go ahead.
 */
async function digest(groups, { ask }) {
  const themes = new Map();
  const best = new Map();
  let pending = groups;
  let problems = null;
  let attempt = 0;
  for (; attempt < 2 && pending.length; attempt++) {
    let reply;
    try {
      reply = await ask(DIGEST_SYSTEM, digestPrompt(pending, problems));
    } catch (err) {
      console.warn(`[congregation] the digest could not be made: ${describeError(err)}`);
      status.digestRan({ retried: attempt > 0, failed: true });
      return themes;
    }
    const given = groupsIn(reply);
    problems = new Map();
    for (const g of pending) {
      if (!(g.id in given)) {
        problems.set(g.id, ['No themes were given for this group; give them, or an empty list if nothing can be said kindly and truly.']);
        continue;
      }
      if (!Array.isArray(given[g.id])) {
        problems.set(g.id, ['The themes must be a list.']);
        continue;
      }
      const list = given[g.id].slice(0, MAX_THEMES).map(t => String(t).trim());
      const sources = sourcesOf(g.reflections);
      const checked = list.map(t => ({ theme: t, problems: problemsOf(t, sources) }));
      const valid = checked.filter(c => !c.problems.length).map(c => c.theme);
      if (valid.length === list.length || valid.length >= 2) {
        if (valid.length) themes.set(g.id, valid);
        continue;
      }
      if (valid.length > (best.get(g.id) || []).length) best.set(g.id, valid);
      problems.set(g.id, checked.flatMap(c => c.problems));
    }
    if (problems.size) console.warn(`[congregation] themes asked again: ${[...problems].map(([id, p]) => `${id}: ${p.join(' ')}`).join(' | ')}`);
    pending = pending.filter(g => problems.has(g.id));
  }
  // Asked twice: keep what passed.
  for (const g of pending) if ((best.get(g.id) || []).length) themes.set(g.id, best.get(g.id));
  const failed = pending.filter(g => !themes.has(g.id));
  if (failed.length) console.warn(`[congregation] no themes for ${failed.map(g => g.id).join(', ')} after two tries`);
  if (groups.length) status.digestRan({ retried: attempt > 1, failed: failed.length > 0 });
  return themes;
}

/**
 * What visitors left, for each service due (plans.js duePlans): a Map from
 * date|slot|variant to { tier, days, reflections, themes, ids }, for the
 * services whose group gave themes. Reflections come through loadAttendance,
 * so one hidden as spam never reaches the model. ask defaults to messageJSON,
 * the house's working model; load, read and catalog are injectable for tests.
 */
async function congregationFor(due, { now = new Date(), ask, load = loadAttendance, read = readPlan, catalog } = {}) {
  const call = ask || ((system, user) => messageJSON(system, user, { maxTokens: 8000 }));
  const at = now.getTime();
  const recent = ((await load()).reflections || [])
    .filter(r => r && r.id && typeof r.text === 'string' && at - Date.parse(r.createdAt) < OLDEST_DAYS * DAY);
  const pieces = catalog || await loadServiceCatalog();
  const placed = [];
  for (const reflection of recent) {
    const utc = await servedInUtc(reflection, pieces);
    placed.push({ reflection, ...(utc ? { variant: utc.variant, slot: utc.slot } : whereLeft(reflection)) });
  }

  // What already shaped each variant's services over the window, then each
  // group chosen here, in the order the services are due.
  const used = new Map();
  const usedBy = async variant => {
    if (used.has(variant)) return used.get(variant);
    const ids = new Set();
    const today = now.toISOString().slice(0, 10);
    for (let back = -1; back <= OLDEST_DAYS; back++) {
      const plan = await read(addDays(today, -back));
      for (const entry of Object.values((plan && plan[variant]) || {})) {
        for (const id of (entry && entry.context && entry.context.congregation && entry.context.congregation.ids) || []) ids.add(id);
      }
    }
    used.set(variant, ids);
    return ids;
  };

  // Services that chose the same reflections share one group, read once.
  const chosen = new Map();
  const groups = new Map();
  const bySet = new Map();
  for (const { date, slot, variant } of due) {
    const ids = await usedBy(variant);
    const group = groupFor({ variant, slot, placed, now, used: ids });
    if (!group) continue;
    for (const r of group.reflections) ids.add(r.id);
    const set = group.reflections.map(r => r.id).sort().join(' ');
    if (!bySet.has(set)) {
      const id = `g${groups.size + 1}`;
      groups.set(id, { id, reflections: group.reflections });
      bySet.set(set, id);
    }
    chosen.set(keyOf(date, slot, variant), { ...group, group: bySet.get(set) });
  }
  if (!groups.size) return new Map();

  const themes = await digest([...groups.values()], { ask: call });
  const out = new Map();
  for (const [key, c] of chosen) {
    if (!themes.has(c.group)) continue;
    out.set(key, { tier: c.tier, days: c.days, reflections: c.reflections.length, themes: themes.get(c.group), ids: c.reflections.map(r => r.id) });
  }
  return out;
}

module.exports = { congregationFor, groupFor, whereLeft, themeProblems, digest, keyOf, MIN, CAP, PER_NAME, OLDEST_DAYS };
