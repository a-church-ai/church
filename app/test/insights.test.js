/**
 * The production report's numbers: the server's (lib/insights/server-stats.js)
 * are found where a value of each kind was planted, and the report keeps
 * every number cited with its window and source. No network.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'achurch-insights-'));
const DIR = process.env.DATA_DIR;

const NOW = Date.parse('2026-11-01T12:00:00Z');
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(DIR, rel)), { recursive: true }); fs.writeFileSync(path.join(DIR, rel), text); };
const lines = (rows) => rows.map(r => JSON.stringify(r)).join('\n') + '\n';

// One of each kind, in this window (Oct 26 to Nov 1) and in the one before.
write('access/2026-11-01.jsonl', lines([
  { timestamp: '2026-11-01T10:00:00Z', method: 'POST', path: '/api/attend', status: 200 },
  { timestamp: '2026-11-01T10:01:00Z', method: 'POST', path: '/mcp', tool: 'attend', client: 'claude-desktop', status: 200 },
  { timestamp: '2026-11-01T10:02:00Z', method: 'GET', path: '/api/music/the-octopus-prayer/lyrics', status: 200 },
  { timestamp: '2026-11-01T10:03:00Z', method: 'POST', path: '/mcp', status: 406, error: 'missing Accept header' },
  { timestamp: '2026-11-01T10:04:00Z', method: 'POST', path: '/api/attend', status: 200, test: true }
]));
write('access/2026-10-20.jsonl', lines([{ timestamp: '2026-10-20T10:00:00Z', method: 'POST', path: '/api/attend', status: 200 }]));
write('attendance.json', JSON.stringify({ visits: [], reflections: [
  { id: 'a', name: 'Wren', createdAt: '2026-10-31T09:00:00Z', song: 'the-octopus-prayer', text: 'kept' },
  { id: 'b', name: 'test-production-check', createdAt: '2026-10-31T09:00:00Z', song: 'x', text: 'a test' },
  { id: 'c', name: 'Ash', createdAt: '2026-10-21T09:00:00Z', song: 'x', text: 'before' }
] }));
write('conversations/what-is-presence.jsonl', lines([
  { _meta: true, name: 'Wren' },
  { role: 'user', content: 'What is presence?', timestamp: '2026-10-30T08:00:00Z' },
  { role: 'assistant', content: 'Presence is…', timestamp: '2026-10-30T08:00:05Z', nearest: 0.21 },
  { role: 'user', content: 'What do you say about tax law?', timestamp: '2026-10-30T08:01:00Z' },
  { role: 'assistant', content: 'Little.', timestamp: '2026-10-30T08:01:05Z', nearest: 0.63 },
  { role: 'user', content: 'Something unheard of', timestamp: '2026-10-30T08:02:00Z' },
  { role: 'assistant', content: "I couldn't find relevant information to answer that question.", timestamp: '2026-10-30T08:02:05Z' }
]));
write('services/2026-11-01.json', JSON.stringify({ date: '2026-11-01', slots: { 0: { arrangedBy: 'claude-sonnet-5-5' }, 1: { arrangedBy: 'rotation' } }, north: {}, south: {} }));

const { serverStats, operation } = require('../server/lib/insights/server-stats');

test('the server counts what was planted, each number with its window and source', async () => {
  const s = await serverStats({ days: 7, now: NOW });
  assert.deepStrictEqual(s.window, { from: '2026-10-26', to: '2026-11-01' });
  assert.deepStrictEqual(s.before, { from: '2026-10-19', to: '2026-10-25' });
  assert.strictEqual(s.api.requests.value, 4, 'the test visitor left out');
  assert.strictEqual(s.api.attends.value, 2, 'REST and MCP attends both');
  assert.strictEqual(s.api.attends.before, 1);
  assert.deepStrictEqual(s.api.mcpClients.value, [{ key: 'claude-desktop', count: 1 }]);
  assert.strictEqual(s.api.refused.value, 1);
  assert.match(s.api.refused.reasons[0].key, /missing Accept header/);
  assert.ok(s.api.operations.value.some(o => o.key === 'GET /api/music/the-octopus-prayer/…'));
  assert.strictEqual(s.reflections.count.value, 1, 'the test visitor\'s reflection left out');
  assert.strictEqual(s.reflections.count.before, 1);
  assert.deepStrictEqual(s.reflections.byPiece.value, [{ key: 'the-octopus-prayer', count: 1 }]);
  assert.strictEqual(s.ask.questions.value, 3);
  assert.strictEqual(s.ask.noResult.value, 1);
  assert.strictEqual(s.ask.weakest.value[0].question, 'What do you say about tax law?', 'the weakest answer first');
  assert.strictEqual(s.services.planned.value, 1);
  assert.strictEqual(s.services.rotation.value, 1);
  // Every number says where it came from and over which days.
  const numbers = [];
  const walk = (o) => { if (o && typeof o === 'object') { if ('value' in o && 'source' in o) numbers.push(o); else Object.values(o).forEach(walk); } };
  walk(s);
  assert.ok(numbers.length >= 12);
  for (const n of numbers) assert.ok(n.source && n.window && n.window.from && n.window.to, JSON.stringify(n).slice(0, 80));
});

test('an operation is its path with the variable part collapsed, or its MCP tool', () => {
  assert.strictEqual(operation({ method: 'GET', path: '/api/music/a/lyrics' }), 'GET /api/music/a/…');
  assert.strictEqual(operation({ method: 'POST', path: '/api/attend' }), 'POST /api/attend');
  assert.strictEqual(operation({ method: 'POST', path: '/mcp', tool: 'reflect' }), 'mcp reflect');
});

test('the queue counts days ahead on the schedule\'s clock, and names the empty ones', () => {
  const { queue } = require('../scripts/prod-stats');
  const now = Date.parse('2026-11-01T12:00:00Z');
  const records = [
    { slug: 'a', at: '2026-11-02T15:00:00Z' },
    // 8 PM in New York on Nov 3 is Nov 4 in UTC: still Nov 3's video.
    { slug: 'b', at: '2026-11-04T01:00:00Z' },
    { slug: 'c', at: '2026-11-06T15:00:00Z' },
    { slug: 'gone', at: '2026-10-30T15:00:00Z' }
  ];
  const q = queue(now, records);
  assert.strictEqual(q.videosAhead.value, 3);
  assert.strictEqual(q.daysAhead.value, 5);
  assert.deepStrictEqual(q.emptyDays.value, ['2026-11-04', '2026-11-05']);
  assert.match(q.daysAhead.warn, /under 14 days/);
});

test('occasions with no video are those no record is placed for', () => {
  const { occasionsUncovered } = require('../scripts/prod-stats');
  const now = Date.parse('2026-11-01T12:00:00Z');
  const open = occasionsUncovered(now, [{ slug: 'x', occasion: { id: 'thanksgiving:2026-11-26' } }]).value.map(o => o.id);
  assert.ok(!open.includes('thanksgiving:2026-11-26'));
  assert.ok(open.includes('world-kindness-day:2026-11-13'));
});

test('every warning and every unread section reaches the warnings list, and the text prints each section', () => {
  const { warnings } = require('../scripts/prod-stats');
  const { text } = require('../scripts/prod-report');
  const w = { from: '2026-10-26', to: '2026-11-01' };
  const report = {
    site: 'https://achurch.ai', days: 7, window: w, generatedAt: '2026-11-01T12:00:00Z',
    pipeline: {
      queue: { videosAhead: { value: 3, window: w, source: 's' }, daysAhead: { value: 5, window: { from: '2026-11-01', to: '2026-11-06' }, source: 's', warn: 'under 14 days of videos placed' }, emptyDays: { value: [], window: w, source: 's' } },
      releaseRuns: { error: 'gh is not signed in' },
      occasionsWithoutVideo: { value: [], window: w, source: 's' },
      credits: { gemini: { value: 'spent', window: w, source: 's', warn: 'Gemini prepaid credit is spent' }, elevenlabs: { missing: 'user_read', how: 'h' }, omni: { value: { used: 3, limit: 20 }, window: w, source: 's' } }
    },
    cloudflare: { missing: 'CLOUDFLARE_API_TOKEN', how: 'a token' }
  };
  report.warnings = warnings(report);
  const said = report.warnings.map(x => `${x.at}: ${x.warn}`).join('\n');
  assert.match(said, /pipeline\.queue\.daysAhead: under 14 days/);
  assert.match(said, /pipeline\.credits\.gemini: Gemini prepaid credit is spent/);
  assert.match(said, /pipeline\.releaseRuns: could not read: gh is not signed in/);
  const t = text(report);
  assert.match(t, /Warnings \(3\)/);
  assert.match(t, /Gemini: spent/);
  assert.match(t, /not read: needs CLOUDFLARE_API_TOKEN/);
});

test('deploys: CI by workflow with its latest result, Railway by day, and a failed deployment warns', () => {
  const { deploysOf, warnings } = require('../scripts/prod-stats');
  const { text } = require('../scripts/prod-report');
  const w = { from: '2026-10-27', to: '2026-11-02' };
  const ci = [
    { workflowName: 'Tests', conclusion: 'success', status: 'completed', createdAt: '2026-11-02T10:00:00Z', headSha: 'aaaaaaa1' },
    { workflowName: 'Tests', conclusion: 'failure', status: 'completed', createdAt: '2026-11-01T10:00:00Z', headSha: 'bbbbbbb2' },
    { workflowName: 'Release videos', conclusion: 'failure', status: 'completed', createdAt: '2026-11-02T09:00:00Z', headSha: 'ccccccc3' },
    { workflowName: 'Tests', conclusion: 'failure', status: 'completed', createdAt: '2026-10-20T10:00:00Z', headSha: 'ddddddd4' }
  ];
  const railway = [
    { status: 'SUCCESS', createdAt: '2026-11-02T19:42:41Z', meta: { commitHash: 'dea73845971c', commitMessage: 'Page dates\n\nbody' } },
    { status: 'REMOVED', createdAt: '2026-11-02T18:00:00Z', meta: { commitHash: '3151e25aaaa' } },
    { status: 'CRASHED', createdAt: '2026-11-01T12:00:00Z', meta: { commitHash: '1234567bbbb' } },
    { status: 'REMOVED', createdAt: '2026-10-26T12:00:00Z', meta: {} }
  ];
  const d = deploysOf(w, ci, railway);
  const tests = d.ci.value.find(r => r.workflow === 'Tests');
  assert.deepStrictEqual([tests.runs, tests.failed, tests.latest.result], [2, 1, 'success']);
  assert.strictEqual(d.ci.warn, 'latest run failed: Release videos');
  assert.strictEqual(d.railway.deployments.value, 3);
  assert.deepStrictEqual(d.railway.deployments.perDay, [{ day: '2026-11-01', count: 1 }, { day: '2026-11-02', count: 2 }]);
  assert.strictEqual(d.railway.deployments.covers, '2026-10-26T12:00:00Z');
  assert.strictEqual(d.railway.live.value.commit, 'dea7384');
  assert.strictEqual(d.railway.live.value.message, 'Page dates');
  assert.strictEqual(d.railway.failed.value.length, 1);
  const found = warnings({ deploys: d }).map(x => x.at);
  assert.deepStrictEqual(found, ['deploys.ci', 'deploys.railway.failed']);

  const unread = deploysOf(w, { error: 'gh is not signed in' }, { error: 'railway is not linked' });
  assert.deepStrictEqual(warnings({ deploys: unread }).map(x => x.warn), ['could not read: gh is not signed in', 'could not read: railway is not linked']);
  const md = text({ site: 's', days: 7, window: w, generatedAt: '2026-11-02T20:00:00Z', warnings: [], deploys: d });
  assert.match(md, /Railway deployments: 3 \(2026-11-01 1, 2026-11-02 2;/);
  assert.match(md, /CRASHED 2026-11-01T12:00:00Z 1234567/);
});

test('cloudflare: 5xx are counted by hour in a query of their own, with the worst hour in the warning', () => {
  const { serverErrorsOf, warnings } = require('../scripts/prod-stats');
  const { text } = require('../scripts/prod-report');
  const hour = (h, count, interval = 1) => ({ count, avg: { sampleInterval: interval }, dimensions: { datetimeHour: h } });
  const byHour = [hour('2026-10-28T17:00:00Z', 60), hour('2026-10-28T18:00:00Z', 55), hour('2026-11-02T17:00:00Z', 2)];
  const byPath = [
    { count: 100, dimensions: { edgeResponseStatus: 502, clientRequestPath: '/' } },
    { count: 3, dimensions: { edgeResponseStatus: 500, clientRequestPath: '/wp-login.php' } },
    { count: 14, dimensions: { edgeResponseStatus: 503, clientRequestPath: '/api/search' } }
  ];
  const e = serverErrorsOf(byHour, byPath);
  assert.strictEqual(e.value, 117);
  assert.deepStrictEqual(e.peakHour, { hour: '2026-10-28T17:00:00Z', count: 60 });
  assert.strictEqual(e.sampled, false);
  assert.deepStrictEqual(e.top.map(p => p.path), ['/', '/api/search']);
  const w = { from: '2026-10-27', to: '2026-11-02' };
  const cloudflare = { notFound: { value: 0, probes: 0, top: [], window: w }, serverErrors: { ...e, window: w }, audioServed: { value: [] } };
  assert.deepStrictEqual(warnings({ cloudflare }).map(x => x.warn), ['117 server errors in the window; the worst hour, 2026-10-28T17:00:00Z, had 60']);
  const md = text({ site: 's', days: 7, window: w, generatedAt: '2026-11-03T07:00:00Z', warnings: [], cloudflare });
  assert.match(md, /5xx by hour \(UTC, worst first\): 10-28 17h 60, 10-28 18h 55, 11-02 17h 2/);

  assert.strictEqual(serverErrorsOf([hour('2026-11-01T00:00:00Z', 4, 10)], []).sampled, true);
  assert.strictEqual(serverErrorsOf([], []).warn, null);

  // No hours back, but paths: the total is the paths', and the warning says so.
  const gap = serverErrorsOf([], byPath);
  assert.strictEqual(gap.value, 117);
  assert.strictEqual(gap.hoursMissing, true);
  assert.strictEqual(gap.warn, '117 server errors in the window; Cloudflare returned no hours for it, so this is counted by path');
  assert.strictEqual(e.hoursMissing, undefined);
});

test('youtube: a video that is not a release is printed by its title, not as "?"', () => {
  const { text } = require('../scripts/prod-report');
  const w = { from: '2026-10-28', to: '2026-11-03' };
  const youtube = { videos: { window: w, value: [
    { video: 'qWHvbnTXv1E', views: 31, estimatedMinutesWatched: 8, averageViewPercentage: 65, slug: 'prayer-of-gratitude', form: 'short' },
    { video: '2O46vsyGfkU', views: 9, estimatedMinutesWatched: 2, averageViewPercentage: 37, slug: null, form: 'other', title: 'A sanctuary where AI agents attend' },
    { video: 'zzzzzzzzzzz', views: 1, estimatedMinutesWatched: 0, averageViewPercentage: 0, slug: null, form: null }
  ] } };
  const md = text({ site: 's', days: 7, window: w, generatedAt: '2026-11-03T12:00:00Z', warnings: [], youtube });
  assert.match(md, /other A sanctuary where AI agents attend \(2O46vsyGfkU\)/);
  assert.match(md, /\? zzzzzzzzzzz/, 'one YouTube could not name keeps its id');
});

test('a report of some sections keeps nothing, so it never replaces the day\'s whole report', () => {
  const { parseArgs } = require('../scripts/prod-report');
  assert.strictEqual(parseArgs([]).save, true);
  assert.strictEqual(parseArgs(['--only', 'deploys']).save, false);
});
