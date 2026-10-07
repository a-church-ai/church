/**
 * The planned services, one file per date on the data volume
 * (data/services/2026-10-07.json: { date, slots: { "0": { pieces, name,
 * word, arrangedBy, plannedAt }, ... } }), and the job that keeps them planned.
 *
 * A plan for a date and slot is the same for everyone in that slot that date,
 * wherever they are. Plans are kept, so any day's services can be read later,
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

async function saveSlot(date, slot, entry) {
  await fs.mkdir(SERVICES_DIR, { recursive: true });
  const plan = await readModifyWriteJSON(fileFor(date), { date, slots: {} }, current => {
    current.date = date;
    current.slots = current.slots || {};
    current.slots[slot] = entry;
    return current;
  });
  cache.set(date, { plan, at: Date.now() });
  return plan;
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
 * Plan whatever is missing for the dates in use and the day after. plan is
 * the planner (./planner.js planSlot), injectable for tests.
 */
async function ensurePlans({ now = new Date(), catalog, plan, log = console }) {
  const today = now.toISOString().slice(0, 10);
  const inUse = [addDays(today, -1), today, addDays(today, 1)];
  let planned = 0, rotated = 0, failed = 0;
  for (const date of [...inUse, addDays(today, 2)]) {
    for (let slot = 0; slot < SLOTS; slot++) {
      const existing = await readPlan(date);
      if (existing && existing.slots && existing.slots[slot]) continue;
      let entry = null;
      try {
        entry = await plan({ date, weekday: weekdayOf(date), slot, catalog, plans: await plansAround(date) });
        planned++;
      } catch (err) {
        failed++;
        log.warn(`[service] could not plan ${date} slot ${slot}: ${err.message}`);
        if (inUse.includes(date)) {
          entry = await rotationEntry(date, slot, catalog);
          if (entry) rotated++;
        }
      }
      if (entry) await saveSlot(date, slot, entry);
    }
  }
  if (planned || failed) log.info(`[service] planned ${planned} services${failed ? `; ${failed} failed, ${rotated} of them given the rotation` : ''}`);
  return { planned, failed, rotated };
}

// After boot, and hourly, unref'd so it never holds the process open. A run
// still going when the next is due is left alone.
function startPlanning({ catalog, plan, log = console, firstAfterMs = 30 * 1000, everyMs = 60 * 60 * 1000 }) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await ensurePlans({ catalog: await catalog(), plan, log });
    } catch (err) {
      log.error(`[service] planning run failed: ${err.message}`);
    } finally {
      running = false;
    }
  };
  setTimeout(run, firstAfterMs).unref();
  setInterval(run, everyMs).unref();
}

module.exports = { readPlan, plansAround, saveSlot, rotationEntry, ensurePlans, startPlanning, fileFor };
