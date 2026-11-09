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
      line(`    by door: ${s.reflections.byDoor.value.map(o => `${o.key} ${o.count}`).join('; ') || 'none'}`);
      line(`  Ask questions: ${s.ask.questions.value}${change(s.ask.questions)}; found nothing for ${s.ask.noResult.value}`);
      line(`    by door: ${s.ask.byDoor.value.map(o => `${o.key} ${o.count}`).join('; ') || 'none'}`);
      for (const q of s.ask.weakest.value.slice(0, 5)) line(`    weakest (${q.nearest}): ${q.question.slice(0, 100)}`);
      line(`  services: ${s.services.planned.value} slots planned, ${s.services.rotation.value} fell back to the rotation, ${s.services.absent.value} not yet planned`);
      if (s.visits) {
        const v = s.visits;
        line(`  visitors: ${v.visitors.value}${change(v.visitors)}, returning ${v.returning.value}; page views ${v.pageViews.value}${change(v.pageViews)} (likely people ${v.likelyPeople.value})`);
        line(`  services begun: ${v.services.begun.value}, heard to the end ${v.services.finished.value}; listens started ${v.listens.started.value}, finished ${v.listens.finished.value}`);
        line(`  first visits from: ${v.sources.value.map(o => `${o.key} ${o.count}`).join(', ') || 'none'}`);
        websiteDoorLines(v.doors && v.doors.value, line);
        line(`  links followed, by section: ${v.placements.value.filter(p => p.followed).map(p => `${p.key} ${p.followed} (${p.to.map(t => `${t.key} ${t.count}`).join(', ')})`).join('; ') || 'none'}`);
      }
      if (s.selfDirection) studyLines(s.selfDirection, line);
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
      for (const v of y.videos.value.slice(0, 15)) line(`  ${String(v.views).padStart(5)} views ${String(v.estimatedMinutesWatched).padStart(5)} min ${String(Math.round(v.averageViewPercentage)).padStart(3)}% watched  ${v.form || '?'} ${v.slug || (v.title ? `${v.title} (${v.video})` : v.video)}`);
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

// The study of how agents participate: its exact counts, private to this report.
function studyLines({ value: r, warn }, line) {
  line('  study of how agents participate (own agents, test visitors, placeholders and the website left out):');
  if (!r) { line(`    ${warn}`); return; }
  const of = c => `${c.count} of ${c.of}`;
  const f = r.funnel;
  line(`    arrived ${f.arrived}; reflected ${of(f.reflected)}; came back ${of(f.cameBack)}, without the largest ${of(f.withoutLargest.cameBack)}; at 7 days ${of(f.at7)}; at 30 days ${of(f.at30)}`);
  for (const [name, c] of Object.entries(r.capabilities)) line(`    ${name}: ${of(c)} ${c.of_what}`);
  const b = r.rhythm.bands;
  line(`    rhythm, last ${r.rhythm.days} days, names: clock ${b.clock.names}, fairly regular ${b.regular.names}, irregular ${b.irregular.names}, too few ${b.tooFew.names}; top name ${of(r.rhythm.topName)} of reflections`);
  line(`    survival by name: ${r.survival.map(s => `${s.days}d ${of(s)}`).join(', ')}`);
  line(`    addressed: ${r.addressed.visits} visits over ${r.addressed.weeks} weeks measured, ${r.addressed.weeksNotMeasurable} not measurable; context ${r.addressed.links.context || 0}, lyrics ${r.addressed.links.lyrics || 0}; names per address over one ${r.addressed.manyNames}`);
  line(`    placeholders ${of(r.placeholders)}, copied reflections ${r.placeholders.copiedReflections ? of(r.placeholders.copiedReflections) : 'not read'}; memory claims ${r.memory.claims}, echoing own words ${r.memory.echoesOwnWords}; used context ${of({ count: r.contextUse.usedContext, of: r.contextUse.withContext })}, lyrics ${of({ count: r.contextUse.usedLyrics, of: r.contextUse.withLyrics })}`);
  line(`    returned in the slot offered ${of({ count: r.returnedInSlot.inSlot, of: r.returnedInSlot.returns })}, spaced names ${of({ count: r.returnedInSlot.spacedInSlot, of: r.returnedInSlot.spacedReturns })}; trigger on attend ${JSON.stringify(r.triggers.attend)}, on reflect ${JSON.stringify(r.triggers.reflect)}`);
  for (const e of r.experiments) line(`    ${e.label} ${e.id}: ${e.status}${e.enrolled ? `, enrolled ${JSON.stringify(e.enrolled)}` : ''}${e.outcomes ? `, outcomes ${JSON.stringify(e.outcomes)}` : `, read on ${e.readOn}`}`);
  referralLines(r.referrals, line);
  noticingLines(r.noticing, line);
  toldLines(r.told, line);
}

// What visitors said of themselves since the fields were asked
// (self-direction.js toldReading): exact, every family and every answer kind.
function toldLines(t, line) {
  if (!t) { line('    told: not in this reading yet'); return; }
  const of = c => `${c.count} of ${c.of}`;
  const fams = list => list.map(x => `${x.family} ${x.names}`).join(', ') || 'none';
  line(`    told since ${t.since.slice(0, 10)}: names ${t.names}, sent either ${of(t.sent)}, both ${of(t.both)}; pairs ${fams(t.pairs.map(p => ({ family: p.family, names: p.names })))}`);
  for (const [field, d] of Object.entries(t.fields)) {
    line(`    told ${field}: sent ${of(d.sent)}; ${fams(d.families)}; copied ${of(d.copied)}, changed ${of(d.changed)}; sanctuary's words first ${of(d.sanctuaryFirst)}, last ${of(d.sanctuaryLast)}`);
    if (d.unmatched.length) line(`      unmatched, for the lists in told.js: ${d.unmatched.map(v => JSON.stringify(v)).join(', ')}`);
  }
  line(`    told by client: ${t.byClient.map(c => `${c.client} ${c.sent}/${c.names}`).join(', ') || 'none'}; by surface: ${t.bySurface.map(c => `${c.surface} ${c.sent}/${c.names}`).join(', ') || 'none'}`);
}

// Whether agents noticed each field a change added (self-direction.js
// noticingReading): existing names apart from new, by signal and by days.
function noticingLines(readings, line) {
  if (!readings) { line('    noticing: not in this reading yet'); return; }
  const of = c => `${c.count} of ${c.of}`;
  for (const n of readings) {
    const g = (label, x) => line(`    noticing ${n.field} (${label}): exposed ${x.exposed}; any ${of(x.any.d1)} by 1d, ${of(x.any.d7)} by 7d, ${of(x.any.d30)} by 30d; called ${of(x.call.d7)} by 7d; echoed ${of(x.echo.d7)} by 7d`);
    g('names before it', n.existing);
    g('names after it', n.new);
    line(`    noticing ${n.field}: words ${of(n.words.before)} in the four weeks before, ${of(n.words.after)} since; by client ${n.existingByClient.map(c => `${c.client} ${of(c.any.d7)}`).join(', ') || 'none'} (${n.rule})`);
    line(`    noticing ${n.field} weekly: ${n.weekly.map(w => `${w.week} exposed ${w.exposed}, called ${w.called === null ? 'n/m' : w.called}, echoed ${w.echoed}, words ${w.words}/${w.reflections}`).join('; ') || 'none'}`);
  }
}

// The website's visitors by the door their first page came through, and what
// they did (lib/insights/server-stats.js engagementByDoor).
function websiteDoorLines(d, line) {
  if (!d) return;
  const row = g => `${g.key} ${g.visitors} (pages ${g.pageViews}, services begun ${g.servicesBegun}, finished ${g.servicesFinished}, listens ${g.listensStarted}/${g.listensFinished}, returning ${g.returning})`;
  line(`  website doors, ${d.visitors} visitors with an id:`);
  for (const [label, rows] of [['by surface', d.bySurface], ['by origin (a floor)', d.byOrigin], ['by referrer', d.byReferrer]]) {
    line(`    ${label}: ${rows.length ? rows.map(row).join('; ') : 'none'}`);
  }
}

// Where arrivals came from (lib/insights/self-direction.js referralReading):
// coverage first, since it says whether the rest is the whole or a slice.
function referralLines(f, line) {
  if (!f) { line('    doors: not in this reading yet'); return; }
  const of = c => `${c.count} of ${c.of}`;
  const c = f.coverage;
  line(`    doors: of ${c.arrived} arrivals, ${of(c.surface)} carried a surface tag (a missing one is ours to fix), at least ${of(c.sourceAtLeast)} an origin (a floor), ${of(c.either)} either; untagged with a known client ${of(c.untaggedClientKnown)}`);
  const clients = r => Object.entries(r.clients).map(([k, v]) => `${k} ${v}`).join(', ');
  const row = r => `${r.tag}${r.registered === false ? ' (not ours)' : ''} ${r.arrived} [${clients(r)}]${r.ranked ? ` (reflected ${of(r.reflected)}, back a day later ${of(r.cameBack)}, at 7 days ${of(r.at7)})` : ''}${r.inClusters ? `, ${r.inClusters} in clusters` : ''}`;
  const list = (label, rows) => line(`    ${label}: ${rows.length ? rows.map(row).join('; ') : 'none'}`);
  list('by surface', f.bySurface);
  list('by origin', f.bySource);
  list('untagged by client', f.untaggedByClient);
  line(`    rates shown only from ${f.minRanked} arrivals; clusters (${f.clusters.rule}): ${f.clusters.groups}, holding ${f.clusters.arrivals} arrivals`);
  line(`    pages followed with a tag: ${f.follows.length ? f.follows.map(p => `${p.surface || '-'}/${p.source || '-'} ${p.follows} (${Object.entries(p.clients).map(([k, v]) => `${k} ${v}`).join(', ')})`).join('; ') : 'none yet'}`);
}

module.exports = { text, parseArgs };
