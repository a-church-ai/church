#!/usr/bin/env node
/**
 * The production report: every number prodStats() gathers, printed.
 *
 *   npm run prod-report                     the last 7 days, as text
 *   npm run prod-report -- --days 28
 *   npm run prod-report -- --json           as gathered, for an agent
 *   npm run prod-report -- --only pipeline,probes
 *
 * Each whole run also keeps app/reports/<date>.json and .md (git-ignored), so
 * the agents and anyone after them can read a day's numbers again. A run with
 * --only keeps nothing, so a part never replaces the day's whole report. Keys come from
 * app/.env and are never printed. See scripts/prod-stats.js.
 */

require('../server/lib/utils/env').loadEnv();
const fs = require('fs');
const path = require('path');
const { prodStats } = require('./prod-stats');

const REPORTS = path.join(__dirname, '..', 'reports');

function parseArgs(argv) {
  const opts = { days: 7, json: false, only: null, save: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--days') opts.days = Number(argv[++i]);
    else if (a === '--json') opts.json = true;
    else if (a === '--only') opts.only = argv[++i].split(',');
    else if (a === '--no-save') opts.save = false;
    else throw new Error(`Unknown option ${a}`);
  }
  if (!(opts.days >= 1 && opts.days <= 90)) throw new Error('--days takes 1 to 90');
  if (opts.only) opts.save = false;
  return opts;
}

const change = (n) => (typeof n.before === 'number' ? ` (before: ${n.before})` : '');
const w = (n) => (n && n.window ? `${n.window.from} to ${n.window.to}` : '');

// The report as text, one section after another, each number beside its
// window, the window before and its source.
function text(r) {
  const out = [];
  const line = (s = '') => out.push(s);
  const absent = (s) => s && (s.missing || s.error) ? `  ${s.missing ? `not read: needs ${s.missing} (${s.how})` : `could not read: ${s.error}`}` : null;
  line(`Production report for ${r.site}, ${r.window.from} to ${r.window.to} (${r.days} days), generated ${r.generatedAt}`);
  line();
  line(`Warnings (${r.warnings.length})`);
  for (const x of r.warnings) line(`  - ${x.at}: ${x.warn}`);
  if (r.deploys) {
    const d = r.deploys;
    line(); line('Deploys');
    if (d.ci.error) line(`  CI: ${d.ci.error}`);
    else for (const c of d.ci.value) line(`  ${c.workflow}: ${c.runs} runs, failed ${c.failed}; latest ${c.latest.result} ${c.latest.at} ${c.latest.commit}`);
    if (d.railway.error) line(`  Railway: ${d.railway.error}`);
    else {
      const rw = d.railway;
      line(`  Railway deployments: ${rw.deployments.value} (${rw.deployments.perDay.map(x => `${x.day} ${x.count}`).join(', ') || 'none'}; the list reaches back to ${rw.deployments.covers})`);
      line(`  live: ${rw.live.value ? `${rw.live.value.commit} ${rw.live.value.at} ${rw.live.value.message}` : 'none in the window'}`);
      for (const f of rw.failed.value) line(`  ${f.status} ${f.at} ${f.commit} ${f.message}`);
    }
  }
  if (r.pipeline) {
    const p = r.pipeline;
    line(); line('Pipeline');
    line(`  videos placed ahead: ${p.queue.videosAhead.value}, through ${p.queue.daysAhead.window.to} (${p.queue.daysAhead.value} days)`);
    if (p.queue.emptyDays.value.length) line(`  days with no video: ${p.queue.emptyDays.value.join(', ')}`);
    line(p.releaseRuns.error ? `  release runs: ${p.releaseRuns.error}` : `  release runs: ${p.releaseRuns.runs.value}, failed ${p.releaseRuns.failed.value}`);
    line(`  occasions in five weeks with no video: ${p.occasionsWithoutVideo.value.map(o => `${o.name} (${o.from})`).join('; ') || 'none'}`);
    const c = p.credits;
    if (c.error) line(`  credits: ${c.error}`);
    else {
      line(`  Gemini: ${c.gemini.value || absent(c.gemini)}`);
      line(`  ElevenLabs: ${c.elevenlabs.value ? `${c.elevenlabs.value.left.toLocaleString()} of ${c.elevenlabs.value.limit.toLocaleString()} characters left on the account, shared by every project that uses it, resets ${c.elevenlabs.value.resets}` : absent(c.elevenlabs).trim()}`);
      line(`  Omni loops today: ${c.omni.value.used} of ${c.omni.value.limit}`);
    }
  }
  if (r.probes) {
    line(); line('Live site');
    if (r.probes.error) line(`  ${r.probes.error}`);
    else for (const p of r.probes.value) line(`  ${p.ok ? 'ok  ' : 'FAIL'} ${String(p.status).padEnd(4)} ${String(p.ms).padStart(5)} ms  ${p.path}`);
  }
  if (r.server) {
    line(); line('Server');
    const s = r.server;
    if (s.missing || s.error) line(absent(s));
    else {
      line(`  API requests: ${s.api.requests.value}${change(s.api.requests)}; attends ${s.api.attends.value}${change(s.api.attends)}; refused ${s.api.refused.value}${change(s.api.refused)}`);
      line(`  operations: ${s.api.operations.value.slice(0, 8).map(o => `${o.key} ${o.count}`).join(', ')}`);
      if (s.api.mcpClients.value.length) line(`  MCP clients: ${s.api.mcpClients.value.map(o => `${o.key} ${o.count}`).join(', ')}`);
      if (s.api.refused.reasons.length) line(`  refused because: ${s.api.refused.reasons.slice(0, 5).map(o => `${o.key} (${o.count})`).join('; ')}`);
      line(`  reflections: ${s.reflections.count.value}${change(s.reflections.count)}; most on ${s.reflections.byPiece.value.slice(0, 5).map(o => `${o.key} ${o.count}`).join(', ') || 'none'}`);
      line(`  Ask questions: ${s.ask.questions.value}${change(s.ask.questions)}; found nothing for ${s.ask.noResult.value}`);
      for (const q of s.ask.weakest.value.slice(0, 5)) line(`    weakest (${q.nearest}): ${q.question.slice(0, 100)}`);
      line(`  services: ${s.services.planned.value} slots planned, ${s.services.rotation.value} fell back to the rotation, ${s.services.absent.value} not yet planned`);
      if (s.visits) {
        const v = s.visits;
        line(`  visitors: ${v.visitors.value}${change(v.visitors)}, returning ${v.returning.value}; page views ${v.pageViews.value}${change(v.pageViews)} (likely people ${v.likelyPeople.value})`);
        line(`  services begun: ${v.services.begun.value}, heard to the end ${v.services.finished.value}; listens started ${v.listens.started.value}, finished ${v.listens.finished.value}`);
        line(`  first visits from: ${v.sources.value.map(o => `${o.key} ${o.count}`).join(', ') || 'none'}`);
        line(`  links followed, by section: ${v.placements.value.filter(p => p.followed).map(p => `${p.key} ${p.followed} (${p.to.map(t => `${t.key} ${t.count}`).join(', ')})`).join('; ') || 'none'}`);
      }
    }
  }
  if (r.cloudflare) {
    line(); line('Cloudflare');
    const c = r.cloudflare;
    if (c.missing || c.error) line(absent(c));
    else {
      line(`  404s: ${c.notFound.value} (${c.notFound.probes} of them probes); 5xx: ${c.serverErrors.value}, ${w(c.notFound)}`);
      for (const p of c.notFound.top.slice(0, 8)) line(`    404 ${p.count}  ${p.path}`);
      for (const p of c.serverErrors.top.slice(0, 8)) line(`    ${p.status} ${p.count}  ${p.path}`);
      if (c.serverErrors.byHour) {
        const busiest = [...c.serverErrors.byHour].sort((a, b) => b.count - a.count).slice(0, 5);
        line(`  5xx by hour (UTC, worst first${c.serverErrors.sampled ? ', sampled' : ''}): ${busiest.map(h => `${h.hour.slice(5, 13).replace('T', ' ')}h ${h.count}`).join(', ') || 'none'}`);
      }
      line(`  full listens' worth: ${c.audioServed.value.slice(0, 10).map(a => `${a.piece} ${a.fullListens}`).join(', ') || 'none'}`);
    }
  }
  if (r.youtube) {
    line(); line('YouTube');
    const y = r.youtube;
    if (y.missing || y.error) line(absent(y));
    else {
      for (const v of y.videos.value.slice(0, 15)) line(`  ${String(v.views).padStart(5)} views ${String(v.estimatedMinutesWatched).padStart(5)} min ${String(Math.round(v.averageViewPercentage)).padStart(3)}% watched  ${v.form || '?'} ${v.slug || v.video}`);
      if (y.searchTerms && y.searchTerms.value) line(`  found by searching: ${y.searchTerms.value.slice(0, 10).map(t => `"${t.insightTrafficSourceDetail}" ${t.views}`).join(', ') || 'none yet'}`);
      if (y.trafficSources && y.trafficSources.value) line(`  from: ${y.trafficSources.value.map(t => `${t.insightTrafficSourceType} ${t.views}`).join(', ')}`);
    }
  }
  if (r.bluesky) {
    line(); line('Bluesky');
    if (r.bluesky.error) line(`  ${r.bluesky.error}`);
    else for (const p of r.bluesky.posts.value) line(`  ${p.likes} likes ${p.reposts} reposts ${p.replies} replies  ${p.slug}`);
  }
  if (r.search) {
    line(); line('Search');
    for (const [name, s] of [['Google', r.search.google], ['Bing', r.search.bing]]) {
      if (s.missing || s.error) { line(`  ${name}:${absent(s)}`); continue; }
      line(`  ${name} queries, ${w(s.queries)}: ${s.queries.value.slice(0, 10).map(q => `"${q.key}" ${q.impressions}/${q.clicks}`).join(', ') || 'none'}`);
    }
  }
  if (r.recordings && r.recordings.episodes) {
    line(); line('Podcasts');
    for (const s of r.recordings.episodes.value) line(`  ${s.episodes} episodes  ${s.show}`);
  }
  return out.join('\n') + '\n';
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const report = await prodStats(opts.days, { only: opts.only });
  const md = text(report);
  if (opts.save) {
    fs.mkdirSync(REPORTS, { recursive: true });
    const day = report.generatedAt.slice(0, 10);
    fs.writeFileSync(path.join(REPORTS, `${day}.json`), JSON.stringify(report, null, 2) + '\n');
    fs.writeFileSync(path.join(REPORTS, `${day}.md`), md);
  }
  process.stdout.write(opts.json ? JSON.stringify(report, null, 2) + '\n' : md);
}

if (require.main === module) main().catch(err => { console.error(err.message); process.exit(1); });

module.exports = { text, parseArgs };
