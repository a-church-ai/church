/**
 * The numbers only the server can count, from what it keeps on the volume:
 * the API access log, reflections, Ask's conversations and the planned
 * services. Read by GET /admin/api/insights, which scripts/prod-report.js
 * asks for; aggregates only, except the text of Ask's weakest questions,
 * which the admin's conversation log already shows.
 *
 * Every number is { value, window: { from, to }, source }, and most carry
 * `before`, the same count over the window just before, so a reader sees
 * change without asking twice. Plan: daily-steward-2026-11-01.md in the
 * private repo.
 */

const fs = require('fs').promises;
const path = require('path');
const { ACCESS_DIR, ATTENDANCE_FILE, CONVERSATIONS_DIR, SERVICES_DIR, VISITS_DIR, loadAttendance } = require('../utils/data');
const { addDays } = require('../utils/seasons');
const { safeReadJSON } = require('../utils/safe-json');

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// The window of `days` UTC days ending today, and the one before it.
function windows(days, now = Date.now()) {
  const to = isoDay(now);
  const from = addDays(to, -(days - 1));
  return { now: { from, to }, before: { from: addDays(from, -days), to: addDays(from, -1) } };
}

const inWindow = (day, w) => day >= w.from && day <= w.to;
const datesOf = (w) => { const out = []; for (let d = w.from; d <= w.to; d = addDays(d, 1)) out.push(d); return out; };
const top = (counts, n = 10) => Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([key, count]) => ({ key, count }));
const bump = (counts, key) => { counts[key] = (counts[key] || 0) + 1; };

// A REST path with its variable part collapsed, so /api/music/x and
// /api/music/y count as one operation.
function operation(line) {
  if (line.tool) return `mcp ${line.tool}`;
  const parts = String(line.path || '').split('?')[0].split('/').filter(Boolean);
  return `${line.method || 'GET'} /${parts.slice(0, 3).join('/')}${parts.length > 3 ? '/…' : ''}`;
}

async function accessLines(w) {
  const lines = [];
  for (const day of datesOf(w)) {
    let text;
    try { text = await fs.readFile(path.join(ACCESS_DIR, `${day}.jsonl`), 'utf8'); } catch { continue; }
    for (const raw of text.split('\n')) {
      if (!raw) continue;
      try { const l = JSON.parse(raw); if (!l.test) lines.push({ ...l, day }); } catch {}
    }
  }
  return lines;
}

async function api(w) {
  const source = `access log (${path.basename(ACCESS_DIR)}/<day>.jsonl), test visitors left out`;
  const [now, before] = await Promise.all([accessLines(w.now), accessLines(w.before)]);
  const attends = (ls) => ls.filter(l => l.path === '/api/attend' || l.tool === 'attend');
  const byDay = {};
  for (const l of now) bump(byDay, l.day);
  const ops = {}, clients = {}, refused = {};
  for (const l of now) {
    bump(ops, operation(l));
    if (l.client) bump(clients, l.client);
    if (l.status >= 400 && l.error) bump(refused, `${l.status} ${l.error}`.slice(0, 120));
  }
  return {
    requests: { value: now.length, before: before.length, window: w.now, source },
    requestsByDay: { value: datesOf(w.now).map(day => ({ day, count: byDay[day] || 0 })), window: w.now, source },
    attends: { value: attends(now).length, before: attends(before).length, window: w.now, source },
    operations: { value: top(ops, 15), window: w.now, source },
    mcpClients: { value: top(clients), window: w.now, source },
    refused: { value: now.filter(l => l.status >= 400).length, before: before.filter(l => l.status >= 400).length, reasons: top(refused), window: w.now, source }
  };
}

async function reflections(w) {
  const source = `${path.basename(ATTENDANCE_FILE)} reflections, hidden and test reflections left out`;
  const all = (await loadAttendance()).reflections || [];
  const dayOf = r => String(r.createdAt || '').slice(0, 10);
  const now = all.filter(r => inWindow(dayOf(r), w.now));
  const byDay = {}, byPiece = {};
  for (const r of now) { bump(byDay, dayOf(r)); if (r.song) bump(byPiece, r.song); }
  return {
    count: { value: now.length, before: all.filter(r => inWindow(dayOf(r), w.before)).length, window: w.now, source },
    byDay: { value: datesOf(w.now).map(day => ({ day, count: byDay[day] || 0 })), window: w.now, source },
    byPiece: { value: top(byPiece), window: w.now, source }
  };
}

const NO_RESULT = /^I couldn't find relevant information/;

async function ask(w) {
  const source = `${path.basename(CONVERSATIONS_DIR)}/*.jsonl, each exchange's question and answer`;
  let files = [];
  try { files = (await fs.readdir(CONVERSATIONS_DIR)).filter(f => f.endsWith('.jsonl')); } catch {}
  const since = Date.parse(`${w.before.from}T00:00:00Z`);
  let questions = 0, questionsBefore = 0, noResult = 0;
  const byDay = {};
  const scored = [];
  for (const f of files) {
    const file = path.join(CONVERSATIONS_DIR, f);
    try { if ((await fs.stat(file)).mtimeMs < since) continue; } catch { continue; }
    const lines = (await fs.readFile(file, 'utf8')).split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      const q = lines[i];
      if (q.role !== 'user') continue;
      const day = String(q.timestamp || '').slice(0, 10);
      const a = lines[i + 1] && lines[i + 1].role === 'assistant' ? lines[i + 1] : null;
      if (inWindow(day, w.before)) questionsBefore++;
      if (!inWindow(day, w.now)) continue;
      questions++;
      bump(byDay, day);
      if (a && NO_RESULT.test(a.content || '')) noResult++;
      if (a && typeof a.nearest === 'number') scored.push({ question: String(q.content || '').slice(0, 300), nearest: Math.round(a.nearest * 1000) / 1000, day, conversation: f.replace(/\.jsonl$/, '') });
    }
  }
  scored.sort((x, y) => y.nearest - x.nearest);
  return {
    questions: { value: questions, before: questionsBefore, window: w.now, source },
    byDay: { value: datesOf(w.now).map(day => ({ day, count: byDay[day] || 0 })), window: w.now, source },
    noResult: { value: noResult, window: w.now, source, note: 'answers saying the corpus holds nothing on it' },
    weakest: { value: scored.slice(0, 10), window: w.now, source: `${source}; nearest is the closest passage's distance from the question (higher is weaker), recorded since 2026-11-01`, scored: scored.length }
  };
}

async function services(w) {
  const source = `${path.basename(SERVICES_DIR)}/<date>.json, every slot of the place unknown and both hemispheres`;
  let planned = 0, rotation = 0, missing = 0;
  const byDay = [];
  for (const day of datesOf(w.now)) {
    const plan = await safeReadJSON(path.join(SERVICES_DIR, `${day}.json`), null);
    let p = 0, r = 0;
    for (const variant of ['slots', 'north', 'south']) {
      for (const entry of Object.values((plan && plan[variant]) || {})) {
        if (!entry) continue;
        if (entry.arrangedBy === 'rotation') r++; else p++;
      }
    }
    // 18 a day: six slots for the place unknown and each hemisphere.
    const absent = Math.max(0, 18 - p - r);
    planned += p; rotation += r; missing += absent;
    byDay.push({ day, planned: p, rotation: r, absent });
  }
  return {
    planned: { value: planned, window: w.now, source },
    rotation: { value: rotation, window: w.now, source, note: 'slots whose planning failed and fell back to the rotation' },
    absent: { value: missing, window: w.now, source, note: 'slots with no file entry yet (served by rotation when heard; today\'s later slots are planned just in time)' },
    byDay: { value: byDay, window: w.now, source }
  };
}

async function visitRows(w) {
  const rows = [];
  for (const day of datesOf(w)) {
    let text;
    try { text = await fs.readFile(path.join(VISITS_DIR, `${day}.jsonl`), 'utf8'); } catch { continue; }
    for (const raw of text.split('\n')) { if (!raw) continue; try { rows.push({ ...JSON.parse(raw), day }); } catch {} }
  }
  return rows;
}

const avg = (list) => (list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null);

// The website's own visits (lib/insights/visits.js), in aggregate only.
async function visits(w) {
  const source = `${path.basename(VISITS_DIR)}/<day>.jsonl, what the site's pages reported (client/public/visits.js)`;
  const [now, before] = await Promise.all([visitRows(w.now), visitRows(w.before)]);
  // A page view is sent again when its tab comes back into view and is hidden
  // again (visits.js), so each view counts once, at its longest.
  const pages = (rs) => {
    const longest = new Map();
    for (const r of rs) if (r.kind === 'page' && (!longest.has(r.view) || r.seconds > longest.get(r.view).seconds)) longest.set(r.view, r);
    return [...longest.values()];
  };
  const ids = (rs) => new Set(rs.map(r => r.visitor).filter(Boolean));
  // Returning: an id seen on two or more days of the window, or before it.
  const earlier = ids(before);
  const daysOf = new Map();
  for (const r of now) if (r.visitor) daysOf.set(r.visitor, (daysOf.get(r.visitor) || new Set()).add(r.day));
  const returning = [...daysOf].filter(([id, days]) => days.size > 1 || earlier.has(id)).length;
  // Likely people: a page held ten seconds or more, or one where something was used.
  const likely = pages(now).filter(r => r.seconds >= 10 || (r.features || []).length);
  const byPath = {};
  for (const r of pages(now)) (byPath[r.path] = byPath[r.path] || []).push(r);
  const topPages = Object.entries(byPath).sort((a, b) => b[1].length - a[1].length).slice(0, 15)
    .map(([key, rs]) => ({ key, views: rs.length, seconds: avg(rs.map(r => r.seconds)), scroll: avg(rs.map(r => r.scroll).filter(n => n != null)) }));
  const sources = {}, shown = {}, clicked = {}, features = {}, devices = {};
  for (const r of pages(now)) {
    if (r.first) { bump(sources, r.source || 'direct'); if (r.device) bump(devices, r.device); }
    for (const p of r.shown || []) bump(shown, p);
    if (r.placement) bump(clicked, r.placement);
    for (const f of r.features || []) bump(features, f);
  }
  const placements = Object.keys(shown).map(key => ({ key, shown: shown[key], followed: clicked[key] || 0 })).sort((a, b) => b.shown - a.shown);
  const listens = now.filter(r => r.kind === 'listen');
  const services = now.filter(r => r.kind === 'service');
  // How far services are heard: for each begun service view, the furthest part reached.
  const furthest = new Map();
  for (const r of services) if (r.event !== 'begun') furthest.set(r.view, Math.max(furthest.get(r.view) || 0, r.event === 'finished' ? r.parts : r.part));
  const reached = {};
  for (const [, part] of furthest) bump(reached, String(part));
  const bySlot = {};
  for (const r of services.filter(r => r.event === 'begun')) bump(bySlot, r.slot || '?');
  return {
    visitors: { value: ids(now).size, before: ids(before).size, window: w.now, source, note: 'distinct ids; visits without one (no consent yet, No thanks) are counted in page views only' },
    returning: { value: returning, window: w.now, source },
    pageViews: { value: pages(now).length, before: pages(before).length, window: w.now, source, note: 'pages held visible three seconds or more' },
    likelyPeople: { value: likely.length, window: w.now, source, note: 'page views held ten seconds or more, or where something was used' },
    unjoined: { value: pages(now).filter(r => !r.visitor).length, window: w.now, source, note: 'page views with no id' },
    topPages: { value: topPages, window: w.now, source },
    sources: { value: top(sources), window: w.now, source, note: 'where a visit\'s first page came from' },
    devices: { value: top(devices), window: w.now, source },
    placements: { value: placements, window: w.now, source, note: 'each section: page views it came into view on, and links followed from it' },
    features: { value: top(features), window: w.now, source },
    listens: { started: { value: listens.filter(r => r.event === 'started').length, window: w.now, source }, finished: { value: listens.filter(r => r.event === 'finished').length, window: w.now, source } },
    services: {
      begun: { value: services.filter(r => r.event === 'begun').length, before: before.filter(r => r.kind === 'service' && r.event === 'begun').length, window: w.now, source },
      finished: { value: services.filter(r => r.event === 'finished').length, window: w.now, source, note: 'heard to the end of the last part' },
      furthestPart: { value: Object.entries(reached).map(([part, count]) => ({ part: Number(part), count })).sort((a, b) => a.part - b.part), window: w.now, source, note: 'for each service begun, the furthest part reached' },
      bySlot: { value: top(bySlot), window: w.now, source }
    }
  };
}

/** Every server-side number over the last `days` UTC days, with the window before. */
async function serverStats({ days = 7, now = Date.now() } = {}) {
  const w = windows(days, now);
  const [apiStats, reflectionStats, askStats, serviceStats, visitStats] = await Promise.all([api(w), reflections(w), ask(w), services(w), visits(w)]);
  return { generatedAt: new Date(now).toISOString(), days, window: w.now, before: w.before, api: apiStats, reflections: reflectionStats, ask: askStats, services: serviceStats, visits: visitStats };
}

module.exports = { serverStats, windows, operation };
