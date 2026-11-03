/**
 * Every number about production, gathered in one place: prodStats(days)
 * returns each as { value, window: { from, to }, source }, most with
 * `before`, the window just before. scripts/prod-report.js prints it; the
 * agents that look after the site read its JSON and decide. This file
 * decides nothing.
 *
 * Sections, each gathered on its own so one that fails or lacks a key says
 * so and the rest still answer:
 *   deploys     CI runs by workflow and Railway's deployments, by day (gh,
 *               the railway CLI linked in this checkout)
 *   pipeline    the video queue, release runs, occasions with no video, the
 *               credits and quotas production spends (this checkout, gh, the
 *               providers' own answers)
 *   probes      the live site's pages, feeds and API, status and time
 *   server      what only the server counts (GET /admin/api/insights)
 *   cloudflare  every 404 by path, 5xx by hour and by path, audio served per recording
 *   youtube     each video's views, watch time and share watched, and the
 *               searches that found the channel
 *   bluesky     each post's likes, reposts and replies
 *   search      Search Console's and Bing's queries and pages
 *   recordings  episodes per podcast show
 *
 * Keys are read from app/.env by presence only and never printed. Plan:
 * daily-steward-2026-11-01.md in the private repo.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { addDays } = require('../server/lib/utils/seasons');
const { occasionsBetween } = require('../server/lib/video/occasions');
const { localTime } = require('../server/lib/utils/timezone');
const { TZ } = require('../server/lib/video/schedule');

const ROOT = path.join(__dirname, '..', '..');
const RELEASES = path.join(ROOT, 'video', 'releases');
const MEDIA = path.join(__dirname, '..', 'media', 'video');
const SITE = process.env.PROD_REPORT_SITE || 'https://achurch.ai';
const SCHEMA_VERSION = 1;

const today = (now) => new Date(now).toISOString().slice(0, 10);
const windowOf = (days, now) => ({ from: addDays(today(now), -(days - 1)), to: today(now) });
const before = (w, days) => ({ from: addDays(w.from, -days), to: addDays(w.from, -1) });
const missing = (what, how) => ({ missing: what, how });
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function releases() {
  if (!fs.existsSync(RELEASES)) return [];
  return fs.readdirSync(RELEASES).filter(f => f.endsWith('.json')).map(f => json(path.join(RELEASES, f)));
}

// ---- pipeline ---------------------------------------------------------------

function queue(now, records = releases()) {
  const source = 'video/releases/*.json';
  const ahead = records.filter(r => r.at && Date.parse(r.at) > now).sort((a, b) => a.at.localeCompare(b.at));
  const last = ahead.length ? ahead[ahead.length - 1].at.slice(0, 10) : null;
  const daysAhead = last ? Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${today(now)}T00:00:00Z`)) / 864e5) : 0;
  // Days from tomorrow to the last placed day that hold no video, on the
  // schedule's own clock (an evening video in New York is the next UTC day).
  const placedDays = new Set(ahead.map(r => localTime(TZ, new Date(r.at)).date));
  const gaps = [];
  for (let d = addDays(today(now), 1); last && d <= last; d = addDays(d, 1)) if (!placedDays.has(d)) gaps.push(d);
  return {
    videosAhead: { value: ahead.length, window: { from: today(now), to: last || today(now) }, source },
    daysAhead: { value: daysAhead, window: { from: today(now), to: last || today(now) }, source, warn: daysAhead < 14 ? `under 14 days of videos placed (last ${last})` : null },
    emptyDays: { value: gaps, window: { from: today(now), to: last || today(now) }, source }
  };
}

function releaseRuns(days, now) {
  const w = windowOf(days, now);
  const source = 'gh run list --workflow release-videos.yml';
  try {
    // By date, not a count: the workflow runs hourly and more, so a fixed
    // limit stopped short of the window's start.
    const out = execFileSync('gh', ['run', 'list', '--workflow', 'release-videos.yml', '--created', `>=${w.from}`, '--limit', '5000', '--json', 'conclusion,createdAt,event,databaseId'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const runs = JSON.parse(out).filter(r => r.createdAt.slice(0, 10) >= w.from);
    const failed = runs.filter(r => r.conclusion === 'failure');
    return {
      runs: { value: runs.length, window: w, source },
      failed: { value: failed.length, window: w, source, latest: failed.slice(0, 5).map(r => ({ at: r.createdAt, id: r.databaseId })) }
    };
  } catch (err) {
    return { error: `gh could not list the release runs: ${err.message.split('\n')[0]}` };
  }
}

function occasionsUncovered(now, records = releases()) {
  const w = { from: addDays(today(now), 1), to: addDays(today(now), 35) };
  const covered = new Set(records.map(r => r.occasion && r.occasion.id).filter(Boolean));
  const open = occasionsBetween(w.from, w.to).filter(o => !covered.has(o.id)).map(o => ({ id: o.id, name: o.name, from: o.from, to: o.to }));
  return { value: open, window: w, source: 'lib/video/occasions.js against video/releases/*.json' };
}

async function credits(now) {
  const out = {};
  // Gemini prepaid credit: there is no balance to read, so one embedding
  // (a fraction of a cent) says whether it is spent: 402 when it is.
  if (process.env.GEMINI_API_KEY) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${process.env.GEMINI_API_KEY}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: { parts: [{ text: 'a sanctuary' }] } }), signal: AbortSignal.timeout(20000)
      });
      out.gemini = { value: res.status === 402 ? 'spent' : res.ok ? 'available' : `answered ${res.status}`, window: { from: today(now), to: today(now) }, source: 'one embedding request to the Gemini API', warn: res.status === 402 ? 'Gemini prepaid credit is spent: renders and Ask will fail' : null };
    } catch (err) { out.gemini = { error: err.message }; }
  } else out.gemini = missing('GEMINI_API_KEY', 'app/.env');
  // ElevenLabs: its subscription answers characters used and the limit, if
  // the key may read the user (user_read).
  if (process.env.ELEVENLABS_API_KEY) {
    try {
      const res = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY }, signal: AbortSignal.timeout(20000) });
      const s = await res.json();
      out.elevenlabs = res.ok
        ? { value: { used: s.character_count, limit: s.character_limit, left: s.character_limit - s.character_count, resets: s.next_character_count_reset_unix ? new Date(s.next_character_count_reset_unix * 1000).toISOString().slice(0, 10) : null }, window: { from: today(now), to: today(now) }, source: 'ElevenLabs /v1/user/subscription: the whole account, which other projects also spend', warn: s.character_limit - s.character_count < 40000 ? 'under 40,000 ElevenLabs characters left (shared with other projects)' : null }
        : missing('ElevenLabs user_read permission', 'give the API key the user_read permission in ElevenLabs, or use a key that has it');
    } catch (err) { out.elevenlabs = { error: err.message }; }
  } else out.elevenlabs = missing('ELEVENLABS_API_KEY', 'app/.env');
  // Omni: 20 loop requests a day, counted from the loops rendered on this
  // machine today (each loop leaves loop-N.mp4.json beside it).
  let loops = 0;
  if (fs.existsSync(MEDIA)) {
    const since = Date.parse(`${today(now)}T00:00:00Z`);
    for (const slug of fs.readdirSync(MEDIA)) {
      const dir = path.join(MEDIA, slug);
      try { for (const f of fs.readdirSync(dir)) if (/^loop-\d+\.mp4\.json$/.test(f) && fs.statSync(path.join(dir, f)).mtimeMs >= since) loops++; } catch {}
    }
  }
  out.omni = { value: { used: loops, limit: 20 }, window: { from: today(now), to: today(now) }, source: 'loops rendered on this machine today (media/video/*/loop-N.mp4.json)' };
  return out;
}

// ---- probes -----------------------------------------------------------------

const PROBES = [
  ['home', '/'], ['attend page', '/attend'], ['a document', '/docs/prayers/prayer-of-gratitude'], ['a song', '/music/the-octopus-prayer'],
  ['a missing page', '/this-page-does-not-exist', 404], ['api now', '/api/now'], ['llms.txt', '/llms.txt'],
  ['prayers podcast', '/podcasts/prayers-and-rituals/feed.xml'], ['mcp', '/mcp', 'any']
];

async function probes(now) {
  const w = { from: today(now), to: today(now) };
  const out = [];
  for (const [name, p, expect = 200] of PROBES) {
    const started = Date.now();
    try {
      const res = await fetch(SITE + p, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
      await res.arrayBuffer();
      out.push({ name, path: p, status: res.status, ms: Date.now() - started, ok: expect === 'any' ? res.status < 500 : res.status === expect });
    } catch (err) {
      out.push({ name, path: p, status: null, ms: Date.now() - started, ok: false, error: err.message });
    }
  }
  return { value: out, window: w, source: `GET ${SITE}`, warn: out.some(p => !p.ok) ? `failing: ${out.filter(p => !p.ok).map(p => p.path).join(', ')}` : null };
}

// ---- server -----------------------------------------------------------------

async function server(days) {
  if (!process.env.ADMIN_API_KEY) return missing('ADMIN_API_KEY', 'app/.env, the same key production holds');
  const res = await fetch(`${SITE}/admin/api/insights?days=${days}`, { headers: { 'X-Admin-Key': process.env.ADMIN_API_KEY }, signal: AbortSignal.timeout(60000) });
  if (res.status === 404) return { error: 'production does not serve /admin/api/insights yet (deploy this branch)' };
  if (!res.ok) return { error: `/admin/api/insights answered ${res.status}` };
  return res.json();
}

// ---- cloudflare -------------------------------------------------------------

async function cloudflareQuery(query, variables) {
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(60000)
  });
  const body = await res.json();
  if (body.errors && body.errors.length) throw new Error(body.errors.map(e => e.message).join('; '));
  return body.data;
}

// Known probes of a site (wp-, .php, .env), counted together, not listed.
const PROBE_PATH = /\.(php|env|git|asp|aspx|jsp|cgi)\b|wp-|\/\.(git|env)|phpmyadmin/i;

async function cloudflare(days, now) {
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ZONE_ID) return missing('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID', 'a read-only token (Zone Analytics: Read, this zone) and the zone id, in app/.env');
  const w = windowOf(Math.min(days, 7), now);
  const source = 'Cloudflare GraphQL, httpRequestsAdaptiveGroups';
  const zone = process.env.CLOUDFLARE_ZONE_ID;
  const statuses = await cloudflareQuery(`query ($zone: String!, $from: Date!, $to: Date!) {
    viewer { zones(filter: { zoneTag: $zone }) {
      httpRequestsAdaptiveGroups(limit: 2000, filter: { date_geq: $from, date_leq: $to, edgeResponseStatus_geq: 400 }, orderBy: [count_DESC]) {
        count dimensions { edgeResponseStatus clientRequestPath }
      } } } }`, { zone, from: w.from, to: w.to });
  const rows = statuses.viewer.zones[0].httpRequestsAdaptiveGroups;
  const sum = (f) => rows.filter(f).reduce((n, r) => n + r.count, 0);
  const listed = (f) => rows.filter(f).filter(r => !PROBE_PATH.test(r.dimensions.clientRequestPath)).slice(0, 20).map(r => ({ path: r.dimensions.clientRequestPath, status: r.dimensions.edgeResponseStatus, count: r.count }));
  const audio = await cloudflareQuery(`query ($zone: String!, $from: Date!, $to: Date!) {
    viewer { zones(filter: { zoneTag: $zone }) {
      httpRequestsAdaptiveGroups(limit: 2000, filter: { date_geq: $from, date_leq: $to, clientRequestPath_like: "/audio/%" }, orderBy: [sum_edgeResponseBytes_DESC]) {
        count sum { edgeResponseBytes } dimensions { clientRequestPath }
      } } } }`, { zone, from: w.from, to: w.to });
  const sizes = audioSizes();
  const listens = audio.viewer.zones[0].httpRequestsAdaptiveGroups.map(r => {
    const file = r.dimensions.clientRequestPath.replace(/^\/audio\//, '').split('?')[0];
    const known = sizes.get(path.basename(file));
    return { file, piece: known ? known.piece : null, requests: r.count, bytes: r.sum.edgeResponseBytes, fullListens: known && known.bytes ? Math.round((r.sum.edgeResponseBytes / known.bytes) * 10) / 10 : null };
  }).filter(r => r.piece).slice(0, 40);
  // 5xx in queries of their own: in the list above, 404 rows filled the
  // limit and hid 40% of them (2026-11-02: 126 counted, 212 served), and a
  // week's total hid that 115 were one 75-minute outage on 10-28.
  const errors = await cloudflareQuery(`query ($zone: String!, $from: Date!, $to: Date!) {
    viewer { zones(filter: { zoneTag: $zone }) {
      byHour: httpRequestsAdaptiveGroups(limit: 1000, filter: { date_geq: $from, date_leq: $to, edgeResponseStatus_geq: 500 }, orderBy: [datetimeHour_ASC]) {
        count avg { sampleInterval } dimensions { datetimeHour }
      }
      byPath: httpRequestsAdaptiveGroups(limit: 1000, filter: { date_geq: $from, date_leq: $to, edgeResponseStatus_geq: 500 }, orderBy: [count_DESC]) {
        count dimensions { edgeResponseStatus clientRequestPath }
      } } } }`, { zone, from: w.from, to: w.to });
  return {
    notFound: { value: sum(r => r.dimensions.edgeResponseStatus === 404), probes: sum(r => r.dimensions.edgeResponseStatus === 404 && PROBE_PATH.test(r.dimensions.clientRequestPath)), top: listed(r => r.dimensions.edgeResponseStatus === 404), window: w, source },
    serverErrors: { ...serverErrorsOf(errors.viewer.zones[0].byHour, errors.viewer.zones[0].byPath), window: w, source: `${source}, 5xx only, by hour and by path` },
    audioServed: { value: listens, window: w, source: `${source}: bytes served per /audio/ file divided by its size (audio/manifest.json, audio/songs.json), so full listens' worth, podcasts and players alike` }
  };
}

// The window's 5xx: the total, each hour that had any (UTC), the worst
// hour, and the paths. sampleInterval 1 means Cloudflare counted every
// request; above it, the counts are estimates.
function serverErrorsOf(byHour, byPath) {
  const value = byHour.reduce((n, r) => n + r.count, 0);
  const hours = byHour.filter(r => r.count > 0).map(r => ({ hour: r.dimensions.datetimeHour, count: r.count }));
  const peak = hours.reduce((a, b) => (b.count > (a ? a.count : 0) ? b : a), null);
  const sampled = byHour.some(r => r.avg && r.avg.sampleInterval > 1);
  const top = byPath.filter(r => !PROBE_PATH.test(r.dimensions.clientRequestPath)).slice(0, 20).map(r => ({ path: r.dimensions.clientRequestPath, status: r.dimensions.edgeResponseStatus, count: r.count }));
  const warn = value ? `${value} server errors in the window${peak ? `; the worst hour, ${peak.hour}, had ${peak.count}` : ''}` : null;
  return { value, byHour: hours, peakHour: peak, sampled, top, warn };
}

// Each served audio file's size and piece, from the manifests.
function audioSizes() {
  const map = new Map();
  const add = (file, bytes, piece) => file && map.set(path.basename(file), { bytes, piece });
  try { for (const [doc, r] of Object.entries(json(path.join(ROOT, 'audio', 'manifest.json')))) add(r.file, r.bytes, path.basename(doc, '.md')); } catch {}
  try { for (const [slug, r] of Object.entries(json(path.join(ROOT, 'audio', 'songs.json')))) add(r.file, r.bytes, slug); } catch {}
  return map;
}

// ---- youtube ----------------------------------------------------------------

async function youtube(days, now) {
  if (!process.env.YOUTUBE_REFRESH_TOKEN) return missing('YOUTUBE_REFRESH_TOKEN', 'npm run youtube:auth');
  const { accessToken } = require('../server/lib/video/publish/youtube');
  const token = await accessToken();
  const w = windowOf(days, now);
  const source = 'YouTube Analytics API v2 (reports), channel==MINE; its numbers lag a day or two';
  const report = async (params) => {
    const res = await fetch(`https://youtubeanalytics.googleapis.com/v2/reports?${new URLSearchParams({ ids: 'channel==MINE', startDate: w.from, endDate: w.to, ...params })}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000) });
    const body = await res.json();
    if (!res.ok) throw new Error((body.error && body.error.message) || `answered ${res.status}`);
    const cols = body.columnHeaders.map(c => c.name);
    return (body.rows || []).map(r => Object.fromEntries(r.map((v, i) => [cols[i], v])));
  };
  const byId = new Map();
  for (const r of releases()) {
    if (r.youtube && r.youtube.id) byId.set(r.youtube.id, { slug: r.slug, form: 'video' });
    if (r.short && r.short.id) byId.set(r.short.id, { slug: r.slug, form: 'short' });
  }
  const videos = (await report({ dimensions: 'video', metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,subscribersGained', sort: '-views', maxResults: '50' }))
    .map(v => ({ ...v, ...(byId.get(v.video) || { slug: null, form: null }) }));
  const out = { videos: { value: videos, window: w, source } };
  // A video that isn't a release (the channel's intro, the old live stream,
  // the first music videos) is named by its YouTube title, one read of
  // videos.list for all of them (1 unit of quota), rather than shown as "?".
  const unknown = videos.filter(v => !v.slug);
  if (unknown.length) {
    try {
      const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({ part: 'snippet', id: unknown.map(v => v.video).join(','), maxResults: '50' })}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
      const body = await res.json();
      if (!res.ok) throw new Error((body.error && body.error.message) || `answered ${res.status}`);
      for (const item of body.items || []) {
        const v = unknown.find(x => x.video === item.id);
        if (v) Object.assign(v, { title: item.snippet.title, form: 'other' });
      }
    } catch (err) { out.videos.titles = { error: `could not name the videos that are not releases: ${err.message}` }; }
  }
  try { out.searchTerms = { value: await report({ dimensions: 'insightTrafficSourceDetail', filters: 'insightTrafficSourceType==YT_SEARCH', metrics: 'views', sort: '-views', maxResults: '25' }), window: w, source: `${source}: views from YouTube search, by the words searched` }; } catch (err) { out.searchTerms = { error: err.message }; }
  try { out.trafficSources = { value: await report({ dimensions: 'insightTrafficSourceType', metrics: 'views,estimatedMinutesWatched', sort: '-views' }), window: w, source }; } catch (err) { out.trafficSources = { error: err.message }; }
  return out;
}

// ---- bluesky ----------------------------------------------------------------

async function bluesky(now) {
  const posts = releases().filter(r => r.bluesky && r.bluesky.uri);
  const source = 'Bluesky public AppView, app.bsky.feed.getPosts';
  const out = [];
  for (let i = 0; i < posts.length; i += 25) {
    const batch = posts.slice(i, i + 25);
    const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?${batch.map(r => `uris=${encodeURIComponent(r.bluesky.uri)}`).join('&')}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) return { error: `getPosts answered ${res.status}` };
    for (const p of (await res.json()).posts || []) {
      const r = batch.find(x => x.bluesky.uri === p.uri);
      out.push({ slug: r && r.slug, likes: p.likeCount, reposts: p.repostCount, replies: p.replyCount, quotes: p.quoteCount });
    }
  }
  return { posts: { value: out, window: { from: posts.map(r => String(r.bluesky.at || r.at || '').slice(0, 10)).filter(Boolean).sort()[0] || today(now), to: today(now) }, source: `${source}; totals since each post` } };
}

// ---- search -----------------------------------------------------------------

async function searchConsole(days, now) {
  const { GOOGLE_OAUTH_CLIENT_ID: id, GOOGLE_OAUTH_CLIENT_SECRET: secret, SEARCH_CONSOLE_REFRESH_TOKEN: refresh } = process.env;
  if (!refresh) return missing('SEARCH_CONSOLE_REFRESH_TOKEN', 'npm run youtube:auth -- --search-console, signed in as a user of the Search Console property');
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: 'refresh_token' }) });
  const token = (await tokenRes.json()).access_token;
  // Search Console's data lags about three days, so the window ends then.
  const w = { from: addDays(today(now), -(days + 2)), to: addDays(today(now), -3) };
  const site = process.env.SEARCH_CONSOLE_SITE || 'sc-domain:achurch.ai';
  const query = async (dimensions) => {
    const res = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ startDate: w.from, endDate: w.to, dimensions, rowLimit: 25 })
    });
    const body = await res.json();
    if (!res.ok) throw new Error((body.error && body.error.message) || `answered ${res.status}`);
    return (body.rows || []).map(r => ({ key: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: Math.round(r.ctr * 1000) / 10, position: Math.round(r.position * 10) / 10 }));
  };
  const source = `Search Console searchAnalytics, ${site}; its data lags about three days`;
  return { queries: { value: await query(['query']), window: w, source }, pages: { value: await query(['page']), window: w, source } };
}

async function bing(now) {
  if (!process.env.BING_WEBMASTER_API_KEY) return missing('BING_WEBMASTER_API_KEY', 'Bing Webmaster Tools, Settings, API access, in app/.env');
  const key = process.env.BING_WEBMASTER_API_KEY;
  const call = async (method) => {
    const res = await fetch(`https://ssl.bing.com/webmaster/api.svc/json/${method}?siteUrl=${encodeURIComponent(SITE + '/')}&apikey=${key}`, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`${method} answered ${res.status}`);
    return (await res.json()).d || [];
  };
  const source = 'Bing Webmaster API; its own recent weeks';
  // Bing answers a row per query (or page) per week; each is summed over the weeks.
  const rows = (list) => {
    const by = new Map();
    for (const r of list) {
      const key = String(r.Query || '').trim();
      const t = by.get(key) || { key, clicks: 0, impressions: 0, positions: [] };
      t.clicks += r.Clicks || 0;
      t.impressions += r.Impressions || 0;
      if (r.AvgImpressionPosition > 0) t.positions.push(r.AvgImpressionPosition);
      by.set(key, t);
    }
    return [...by.values()].sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks).slice(0, 25)
      .map(({ positions, ...t }) => ({ ...t, position: positions.length ? Math.round(positions.reduce((a, b) => a + b, 0) / positions.length * 10) / 10 : null }));
  };
  return { queries: { value: rows(await call('GetQueryStats')), window: { from: addDays(today(now), -28), to: today(now) }, source }, pages: { value: rows(await call('GetPageStats')), window: { from: addDays(today(now), -28), to: today(now) }, source } };
}

// ---- recordings -------------------------------------------------------------

function recordings(now) {
  const { SHOWS } = require('../server/lib/audio/podcasts');
  const manifest = json(path.join(ROOT, 'audio', 'manifest.json'));
  const sectionOf = doc => doc.split('/')[1];
  const shows = SHOWS.map(s => ({ show: s.title, episodes: Object.keys(manifest).filter(d => s.sections.includes(sectionOf(d))).length }));
  return { episodes: { value: shows, window: { from: today(now), to: today(now) }, source: 'audio/manifest.json against lib/audio/podcasts.js SHOWS' } };
}

// ---- deploys -----------------------------------------------------------------

// CI runs and Railway's deployments in the window, from what gh and railway
// answered. Each workflow's latest run says whether it is still broken; a
// deployment that failed or crashed is a warning. Railway lists only its
// latest twenty deployments, so `covers` says how far back the list reaches.
function deploysOf(w, ciRuns, railwayList) {
  const inWindow = (at) => at && at.slice(0, 10) >= w.from && at.slice(0, 10) <= w.to;
  const out = {};
  if (ciRuns.error) out.ci = { error: ciRuns.error };
  else {
    const runs = ciRuns.filter(r => inWindow(r.createdAt)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const byWorkflow = {};
    for (const r of runs) {
      const k = r.workflowName;
      const row = byWorkflow[k] || (byWorkflow[k] = { workflow: k, runs: 0, failed: 0, latest: { at: r.createdAt, result: r.conclusion || r.status, commit: (r.headSha || '').slice(0, 7) } });
      row.runs++;
      if (r.conclusion === 'failure') row.failed++;
    }
    const rows = Object.values(byWorkflow).sort((a, b) => b.runs - a.runs);
    const broken = rows.filter(r => r.latest.result === 'failure').map(r => r.workflow);
    out.ci = { value: rows, window: w, source: 'gh run list --branch main', warn: broken.length ? `latest run failed: ${broken.join(', ')}` : null };
  }
  if (railwayList.error) out.railway = { error: railwayList.error };
  else {
    const all = railwayList.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const list = all.filter(d => inWindow(d.createdAt)).map(d => ({ at: d.createdAt, status: d.status, commit: ((d.meta && d.meta.commitHash) || '').slice(0, 7), message: ((d.meta && d.meta.commitMessage) || '').split('\n')[0].slice(0, 80) }));
    const perDay = {};
    for (const d of list) perDay[d.at.slice(0, 10)] = (perDay[d.at.slice(0, 10)] || 0) + 1;
    const failed = list.filter(d => d.status === 'FAILED' || d.status === 'CRASHED');
    const live = list.find(d => d.status === 'SUCCESS') || null;
    out.railway = {
      deployments: { value: list.length, perDay: Object.entries(perDay).map(([day, count]) => ({ day, count })).sort((a, b) => a.day.localeCompare(b.day)), window: w, source: 'railway deployment list', covers: all.length ? all[all.length - 1].createdAt : null },
      live: { value: live, window: w, source: 'railway deployment list' },
      failed: { value: failed, window: w, source: 'railway deployment list', warn: failed.length ? `${failed.length} deployment(s) failed or crashed, latest ${failed[0].at}` : null }
    };
  }
  return out;
}

function readJSONCommand(cmd, args, what) {
  try {
    return JSON.parse(execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000 }));
  } catch (err) {
    return { error: `${what}: ${err.message.split('\n')[0]}` };
  }
}

function deploys(days, now) {
  const w = windowOf(days, now);
  const ci = readJSONCommand('gh', ['run', 'list', '--branch', 'main', '--created', `>=${w.from}`, '--limit', '5000', '--json', 'workflowName,conclusion,status,createdAt,headSha'], 'gh could not list the runs');
  const railway = readJSONCommand('railway', ['deployment', 'list', '--json'], 'railway could not list the deployments (installed, signed in and linked here?)');
  return deploysOf(w, ci, railway);
}

// ---- all --------------------------------------------------------------------

async function section(fn) {
  try { return await fn(); } catch (err) { return { error: err.message }; }
}

/** Every number about production over the last `days` days. */
async function prodStats(days = 7, { now = Date.now(), only = null } = {}) {
  const want = (name) => !only || only.includes(name);
  const w = windowOf(days, now);
  const out = { schema_version: SCHEMA_VERSION, generatedAt: new Date(now).toISOString(), site: SITE, days, window: w, before: before(w, days) };
  if (want('deploys')) out.deploys = deploys(days, now);
  if (want('pipeline')) out.pipeline = { queue: queue(now), releaseRuns: releaseRuns(days, now), occasionsWithoutVideo: occasionsUncovered(now), credits: await section(() => credits(now)) };
  if (want('probes')) out.probes = await section(() => probes(now));
  if (want('server')) out.server = await section(() => server(days));
  if (want('cloudflare')) out.cloudflare = await section(() => cloudflare(days, now));
  if (want('youtube')) out.youtube = await section(() => youtube(days, now));
  if (want('bluesky')) out.bluesky = await section(() => bluesky(now));
  if (want('search')) out.search = { google: await section(() => searchConsole(days, now)), bing: await section(() => bing(now)) };
  if (want('recordings')) out.recordings = await section(() => recordings(now));
  out.warnings = warnings(out);
  return out;
}

// Every warn the sections raised, in one list, so a reader starts there.
function warnings(report) {
  const found = [];
  const walk = (o, at) => {
    if (!o || typeof o !== 'object') return;
    if (typeof o.warn === 'string' && o.warn) found.push({ at, warn: o.warn });
    if (o.error && typeof o.error === 'string') found.push({ at, warn: `could not read: ${o.error}` });
    for (const [k, v] of Object.entries(o)) if (k !== 'warn' && v && typeof v === 'object') walk(v, at ? `${at}.${k}` : k);
  };
  walk(report, '');
  return found;
}

module.exports = { prodStats, warnings, queue, occasionsUncovered, deploysOf, serverErrorsOf, audioSizes, SCHEMA_VERSION, PROBES };
