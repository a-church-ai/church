/**
 * The planned services, one file per date on the data volume
 * (data/services/2026-10-07.json: { date, slots: { "0": { pieces, name,
 * word, arrangedBy, plannedAt, context }, ... }, north: { ... }, south:
 * { ... } }), and the job that keeps them planned.
 *
 * Each slot is planned three times: `slots` for a place unknown (no timezone,
 * UTC, an Etc/ zone), as every plan was before seasons, and `north` and
 * `south` for the hemispheres, each told its season and light (planner.js).
 * A visitor gets their hemisphere's plan, or else the season-less one, or
 * else the rotation (serve.js), so a failed seasonal plan costs the season,
 * never the service. A file written before seasons has no `north` or `south`
 * at all, and its date is served season-less; nothing is migrated. In a
 * hemisphere's map a null slot means "decided: use the season-less plan",
 * written when its date is already in use and the model failed, so it is not
 * retried every hour. Plan: seasonal-services-2026-10-08.md in the private
 * repo.
 *
 * A plan for a date, slot and hemisphere is the same for everyone in it, the
 * same way the clock is. Plans are kept, so any day's services can be read later,
 * and a poor one can be replaced by editing its file; the server reads it
 * again within a minute.
 *
 * The job runs after boot and then hourly. At any moment the local dates in
 * use somewhere on Earth are yesterday, today and tomorrow in UTC, so it makes
 * sure those are planned, and the day after, so each date is planned a full
 * day before its first slot begins. A slot the model can't plan is retried on
 * the next run, unless its date is already in use, when it gets the rotation
 * (./rules.js) and keeps it. No cron and no exact time to miss: a restart
 * plans whatever is missing. The app runs as one process, so one job plans.
 */

const fs = require('fs').promises;
const path = require('path');
const { readModifyWriteJSON, safeReadJSON } = require('../utils/safe-json');
const { SERVICES_DIR } = require('../utils/data');
const { addDays, rotation, exclusions } = require('./rules');
const { SLOTS } = require('./slots');

// The hemispheres planned beside the season-less `slots`.
const HEMISPHERES = ['north', 'south'];

const fileFor = date => path.join(SERVICES_DIR, `${date}.json`);

// Read plans are kept for a minute: /api/now is polled, and a plan replaced
// by hand on the volume still shows within the minute.
const CACHE_MS = 60 * 1000;
const cache = new Map();

async function readPlan(date) {
  const hit = cache.get(date);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.plan;
  const plan = await safeReadJSON(fileFor(date), null);
  cache.set(date, { plan, at: Date.now() });
  return plan;
}

// The date and the days before it that a slot's rules and the planner look
// back over, as a map from date to plan.
async function plansAround(date, back = 21) {
  const plans = new Map();
  for (let d = 0; d <= back; d++) {
    const day = addDays(date, -d);
    const plan = await readPlan(day);
    if (plan) plans.set(day, plan);
  }
  return plans;
}

// Save a slot's entry: in `slots` (the season-less plan) or a hemisphere's
// map. A new file starts with both hemispheres' maps, which is what marks a
// date as planned with seasons.
async function saveSlot(date, slot, entry, variant = 'slots') {
  await fs.mkdir(SERVICES_DIR, { recursive: true });
  const plan = await readModifyWriteJSON(fileFor(date), { date, slots: {}, north: {}, south: {} }, current => {
    current.date = date;
    current.slots = current.slots || {};
    current[variant] = current[variant] || {};
    current[variant][slot] = entry;
    return current;
  });
  cache.set(date, { plan, at: Date.now() });
  return plan;
}

// Plans as one variant sees them (`slots`, `north` or `south`), in the shape
// the rules and the planner read ({ slots }), so each hemisphere's no-repeat
// windows and recent services are its own history: what its visitors saw.
function planView(plans, variant) {
  if (variant === 'slots') return plans;
  const view = new Map();
  for (const [date, plan] of plans) {
    const slots = Object.fromEntries(Object.entries((plan && plan[variant]) || {}).filter(([, entry]) => entry));
    view.set(date, { date, slots });
  }
  return view;
}

// The slot's service by rotation, for when no plan was made: deterministic,
// so everyone in the slot gets the same until a plan exists. Should what the
// slot can't repeat leave nothing to hold, it repeats rather than go silent,
// though still only with pieces whose hours reach the slot.
async function rotationEntry(date, slot, catalog) {
  const plans = await plansAround(date);
  const pieces = rotation({ date, slot, catalog, excluded: exclusions({ date, slot, plans, catalog }) })
    || rotation({ date, slot, catalog, excluded: exclusions({ date, slot, plans: new Map(), catalog }) });
  return pieces ? { pieces, name: null, word: null, arrangedBy: 'rotation', plannedAt: new Date().toISOString() } : null;
}

const weekdayOf = date => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long' });

/**
 * Plan whatever is missing for the dates in use and the day after: each
 * slot's season-less plan, then its two hemispheres'. plan is the planner
 * (./planner.js planSlot) and context builds what each is told of its season,
 * sky and Earth (planner.js contextFor); without one, plans are made without
 * it. feeds fetches the public data the context draws on (planner.js
 * fetchFeeds), at most once a run and only when a plan is to be made with a
 * context; without it there are none, so the job itself knows no source and
 * reaches no network. All four are injectable for tests.
 */
async function ensurePlans({ now = new Date(), catalog, plan, context = null, feeds = async () => null, log = console }) {
  const today = now.toISOString().slice(0, 10);
  const inUse = [addDays(today, -1), today, addDays(today, 1)];
  let planned = 0, rotated = 0, failed = 0;
  let fetched;
  const fed = async () => {
    if (fetched === undefined) fetched = await feeds();
    return fetched;
  };
  for (const date of [...inUse, addDays(today, 2)]) {
    for (let slot = 0; slot < SLOTS; slot++) {
      for (const variant of ['slots', ...HEMISPHERES]) {
        const existing = await readPlan(date);
        // A date planned before seasons has no hemisphere maps: served season-less.
        if (variant !== 'slots' && existing && !existing[variant]) continue;
        if (existing && existing[variant] && slot in existing[variant]) continue;
        const hemisphere = variant === 'slots' ? null : variant;
        let entry = null;
        try {
          const plans = planView(await plansAround(date), variant);
          const told = context ? await context({ date, hemisphere, feeds: await fed() }) : null;
          entry = await plan({ date, weekday: weekdayOf(date), slot, catalog, plans, context: told });
          planned++;
        } catch (err) {
          failed++;
          log.warn(`[service] could not plan ${date} slot ${slot}${hemisphere ? ` (${hemisphere})` : ''}: ${err.message}`);
          if (inUse.includes(date)) {
            if (variant === 'slots') {
              entry = await rotationEntry(date, slot, catalog);
              if (entry) rotated++;
            } else {
              // Decided: this hemisphere gets the season-less plan for this slot.
              await saveSlot(date, slot, null, variant);
            }
          }
        }
        if (entry) await saveSlot(date, slot, entry, variant);
      }
    }
  }
  if (planned || failed) log.info(`[service] planned ${planned} services${failed ? `; ${failed} failed, ${rotated} of them given the rotation` : ''}`);
  return { planned, failed, rotated };
}

// After boot, and hourly, unref'd so it never holds the process open. A run
// still going when the next is due is left alone.
function startPlanning({ catalog, plan, context, feeds, log = console, firstAfterMs = 30 * 1000, everyMs = 60 * 60 * 1000 }) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await ensurePlans({ catalog: await catalog(), plan, context, feeds, log });
    } catch (err) {
      log.error(`[service] planning run failed: ${err.message}`);
    } finally {
      running = false;
    }
  };
  setTimeout(run, firstAfterMs).unref();
  setInterval(run, everyMs).unref();
}

module.exports = { readPlan, plansAround, planView, saveSlot, rotationEntry, ensurePlans, startPlanning, fileFor, HEMISPHERES };
