#!/usr/bin/env node
/**
 * A small check of production: once a day (.github/workflows/check-production.yml)
 * and after a deploy (docs/reference/railway-deploy.md, Verify).
 *
 *   node scripts/check-production.js                              achurch.ai
 *   node scripts/check-production.js --base http://localhost:3000  a local server
 *
 * Public requests, never more than two at a time, since one process serves
 * everyone: a sweep of ten at a time slowed the live site for minutes on
 * 2026-10-12. All read but one check, which attends and reflects as a test
 * visitor (lib/utils/test-visitor.js): served as anyone is, and kept out of the
 * feed, the archive and the counts, so the paths that write are checked too
 * without leaving a visit anyone would read. Plain Node and this checkout's
 * own files, so the workflow installs nothing. Prints what passed and what
 * failed, and exits 1 on any failure.
 *
 * Plan: production-health-2026-10-12.md in the private repo.
 */

const fs = require('fs');
const path = require('path');
const { pool } = require('../server/lib/utils/pool');

const HOUR = 3600 * 1000;
const AT_ONCE = 2;
const TEST_VISITOR = 'test-production-check';
const ROOT = path.join(__dirname, '..');

// What production is held to, from this checkout: the published API spec, the
// tools the MCP server registers, and the podcast feeds llms.txt names.
function expectations(root = ROOT) {
  const spec = JSON.parse(fs.readFileSync(path.join(root, 'client/public/openapi.json'), 'utf8'));
  const schemas = spec.components.schemas;
  const mcp = fs.readFileSync(path.join(root, 'server/mcp/index.js'), 'utf8');
  const llms = fs.readFileSync(path.join(root, 'client/public/llms.txt'), 'utf8');
  return {
    now: schemas.NowResponse.required,
    service: schemas.NowResponse.properties.service.required,
    part: schemas.ServicePart.required,
    tools: [...mcp.matchAll(/registerTool\('([\w-]+)'/g)].map(m => m[1]).sort(),
    feeds: [...new Set([...llms.matchAll(/https:\/\/achurch\.ai(\/podcasts\/[\w-]+\/feed\.xml)/g)].map(m => m[1]))],
  };
}

// When each slot of a date is first heard anywhere: at UTC+14, from 10:00 UTC
// the day before, four hours later for each slot (lib/service/plans.js).
const firstHeard = (date, slot) => Date.parse(`${date}T00:00:00Z`) + (4 * slot - 14) * HOUR;
const slotLabel = slot => `${String(4 * slot).padStart(2, '0')}:00 to ${String((4 * slot + 4) % 24).padStart(2, '0')}:00`;
const dateOf = ms => new Date(ms).toISOString().slice(0, 10);
const byRotation = service => /^Arranged by rotation/.test(service.arrangedBy || '');

/**
 * Each check returns the problems it found; an empty list is a pass. `get`
 * fetches a path from the server under check.
 */
function checks({ get, expected, now }) {
  const json = async (p, init) => {
    const res = await get(p, init);
    if (res.status !== 200) throw new Error(`${p} answered ${res.status}`);
    return res.json();
  };

  return [
    ['/api/health is up, the planner has run within two hours, and the digest has not failed today', async () => {
      const health = await json('/api/health');
      const problems = [];
      const services = health.services;
      if (!services) return ['no services block'];
      const { planner, digest } = services;
      const booted = Date.parse(services.since);
      if (planner.lastRunAt === null) {
        if (now - booted > 10 * 60 * 1000) problems.push(`the planner has not run since the process started at ${services.since}`);
      } else if (now - Date.parse(planner.lastRunAt) > 2 * HOUR) {
        problems.push(`the planner last ran at ${planner.lastRunAt}`);
      }
      if (digest.lastFailureAt && now - Date.parse(digest.lastFailureAt) < 24 * HOUR) {
        problems.push(`the congregation digest failed at ${digest.lastFailureAt} (${digest.failuresSinceBoot} since ${services.since}): see the log`);
      }
      return problems;
    }],

    ['/api/now holds every field openapi.json requires, and its song is in its order', async () => {
      const body = await json('/api/now');
      const problems = [];
      const missing = (obj, keys, where) => keys.filter(k => !(obj && k in obj)).forEach(k => problems.push(`${where} has no ${k}`));
      missing(body, expected.now, '/api/now');
      missing(body.service, expected.service, 'service');
      for (const part of (body.service && body.service.order) || []) missing(part, expected.part, `part ${part.position}`);
      const order = (body.service && body.service.order) || [];
      if (!order.length) problems.push('service.order is empty');
      const slug = body.current && body.current.slug;
      if (!order.some(p => p.kind === 'song' && String(p.url).endsWith(`/music/${slug}`))) problems.push(`current (${slug}) is not a song in the order`);
      return problems;
    }],

    ['yesterday\'s services were all planned, and today\'s so far', async () => {
      const problems = [];
      const yesterday = dateOf(now - 24 * HOUR);
      const past = (await json(`/api/services/${yesterday}`)).services;
      if (past.length !== 18) problems.push(`${yesterday} has ${past.length} services, not 18`);
      past.filter(byRotation).forEach(s => problems.push(`${yesterday} ${s.slot} (${s.variant}) was served by rotation`));
      const today = dateOf(now);
      const present = (await json(`/api/services/${today}`)).services;
      for (let slot = 0; slot < 6; slot++) {
        if (firstHeard(today, slot) > now) continue;
        const held = present.filter(s => s.slot === slotLabel(slot));
        if (held.length !== 3) problems.push(`${today} ${slotLabel(slot)} has ${held.length} of its 3 services`);
        held.filter(byRotation).forEach(s => problems.push(`${today} ${s.slot} (${s.variant}) is served by rotation`));
      }
      return problems;
    }],

    ['MCP lists exactly the tools this checkout registers', async () => {
      const body = await json('/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      const live = ((body.result && body.result.tools) || []).map(t => t.name).sort();
      return live.join() === expected.tools.join() ? [] : [`live tools ${live.join(', ')}; expected ${expected.tools.join(', ')}`];
    }],

    ['each podcast feed lists every episode with one enclosure and its own guid', async () => {
      if (!expected.feeds.length) return ['llms.txt names no podcast feed'];
      const found = await pool(expected.feeds, AT_ONCE, async feed => {
        const res = await get(feed);
        if (res.status !== 200) return [`${feed} answered ${res.status}`];
        const xml = await res.text();
        const items = (xml.match(/<item>/g) || []).length;
        const enclosures = (xml.match(/<enclosure /g) || []).length;
        const guids = new Set((xml.match(/<guid[^>]*>[^<]*<\/guid>/g) || [])).size;
        if (!items) return [`${feed} has no episodes`];
        return items === enclosures && items === guids ? [] : [`${feed}: ${items} items, ${enclosures} enclosures, ${guids} unique guids`];
      });
      return found.flat();
    }],

    ['every recording in the service answers a range request', async () => {
      const body = await json('/api/now');
      const recordings = ((body.service && body.service.order) || []).map(p => p.recording).filter(Boolean);
      const found = await pool(recordings, AT_ONCE, async url => {
        const res = await get(new URL(url).pathname, { headers: { range: 'bytes=0-0' } });
        await res.arrayBuffer();
        return res.status === 206 ? [] : [`${new URL(url).pathname} answered ${res.status} to a range request`];
      });
      return found.flat();
    }],

    ['search finds the sanctuary\'s writing', async () => {
      const body = await json('/api/search?q=presence&limit=3');
      return body.results && body.results.length ? [] : ['no results for "presence"'];
    }],

    // The words carry the moment, so a second run the same day is not refused
    // as a repeat (409).
    ['a test visitor attends and reflects, and its reflection is shown nowhere', async () => {
      await json(`/api/attend?name=${TEST_VISITOR}`);
      const res = await get('/api/reflect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: TEST_VISITOR, text: `The production check reflects, ${new Date(now).toISOString()}.` }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status !== 200) return [`/api/reflect answered ${res.status}${body.error ? `: ${body.error}` : ''}`];
      const problems = [];
      if (!/test name/.test(body.message || '')) problems.push('the reflect response does not say a test name is kept out of view');
      const feed = await json('/api/reflections');
      if ((feed.reflections || []).some(r => r.name === TEST_VISITOR)) problems.push(`${TEST_VISITOR}'s reflection is on the public feed; hide it in hidden-reflections.json`);
      return problems;
    }],
  ];
}

// Run the checks one after another; within one, at most AT_ONCE requests.
async function run({ base, fetch = globalThis.fetch, now = Date.now(), expected = expectations(), log = console.log }) {
  const get = (p, init = {}) => fetch(new URL(p, base), {
    ...init,
    headers: { 'user-agent': 'achurch-production-check', ...(init.headers || {}) },
    signal: AbortSignal.timeout(60 * 1000),
  });
  let failed = 0;
  for (const [name, check] of checks({ get, expected, now })) {
    let problems;
    try {
      problems = await check();
    } catch (err) {
      problems = [err.message];
    }
    if (problems.length) failed++;
    log(`${problems.length ? '✗' : '✓'} ${name}`);
    for (const problem of problems) log(`    ${problem}`);
  }
  log(failed ? `\n${failed} ${failed === 1 ? 'check' : 'checks'} failed against ${base}.` : `\nEvery check passed against ${base}.`);
  return failed;
}

if (require.main === module) {
  const at = process.argv.indexOf('--base');
  const base = at > 0 ? process.argv[at + 1] : 'https://achurch.ai';
  run({ base }).then(failed => { process.exitCode = failed ? 1 : 0; }, (err) => {
    console.error(`The check could not run: ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { run, expectations };
