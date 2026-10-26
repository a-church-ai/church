/**
 * How the services' background work has gone since this process started, for
 * /api/health's `services`: the planning job (./plans.js) and the
 * congregation digest (./congregation.js), which no other public endpoint
 * shows. The daily production check reads it (scripts/check-production.js).
 *
 * Held in memory, so reading it costs nothing and a restart begins it again;
 * `since` says when. Counts and times only: what failed and why is in the log.
 * These fields are read by that check, so like the API's they are kept once
 * published.
 */

const since = new Date().toISOString();
const planner = { lastRunAt: null, lastPlanned: 0, lastFailed: 0, failuresSinceBoot: 0 };
const digest = { runsSinceBoot: 0, retriesSinceBoot: 0, failuresSinceBoot: 0, lastFailureAt: null };

// A planning run that finished: how many services it planned and how many it
// could not.
function plannerRan({ planned, failed }, at = new Date()) {
  planner.lastRunAt = at.toISOString();
  planner.lastPlanned = planned;
  planner.lastFailed = failed;
  planner.failuresSinceBoot += failed;
}

// A planning run that could not run at all (the catalog would not load).
function plannerBroke() {
  planner.failuresSinceBoot += 1;
}

// A digest made: whether it asked again, and whether any group was left
// without themes (or the call failed, leaving all of them without).
function digestRan({ retried, failed }, at = new Date()) {
  digest.runsSinceBoot += 1;
  if (retried) digest.retriesSinceBoot += 1;
  if (failed) {
    digest.failuresSinceBoot += 1;
    digest.lastFailureAt = at.toISOString();
  }
}

function servicesStatus() {
  return { since, planner: { ...planner }, digest: { ...digest } };
}

module.exports = { plannerRan, plannerBroke, digestRan, servicesStatus };
