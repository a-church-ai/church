/**
 * /ai-experiment and what the study adds to the API: the rule that hides exact
 * counts and not smallness, the arms, which only add, the optional fields, which
 * are never refused and never public, and the website's marker. No network.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'achurch-experiment-'));
const store = require('../../server/lib/db');
const { resetDb, seedConversation } = require('../database');
require('node:test').before(resetDb);
process.env.RETURN_TOKEN_SECRET = 'for these tests only';

const { share, publicReading, roundedParts, TOO_FEW } = require('../../server/lib/insights/public-results');
const { renderTop, renderResults, renderCorrections, renderHomeExperiment } = require('../../server/lib/insights/public-charts');
const sd = require('../../server/lib/insights/self-direction');
const { attendance, reflections } = require('../../server/lib/api');
const experiments = require('../../server/lib/insights/experiments');
const token = require('../../server/lib/insights/return-token');
const offers = require('../../server/lib/insights/return-offers');
const ns = require('../../server/lib/utils/next-steps');
const inputs = require('../../server/lib/api/inputs');
const { spec } = require('../../server/lib/api/openapi');
const { DOOR_HEADER } = require('../../server/lib/insights/study-names');
const { doorOf } = require('../../server/lib/insights/study-names');

const PUBLIC = path.join(__dirname, '../../client/public');
const read = (file) => fs.readFileSync(path.join(PUBLIC, file), 'utf8');
const AFTER = Date.parse('2026-12-01T12:00:00Z');
const ctx = (extra = {}) => ({ baseUrl: 'https://achurch.ai', ip: '127.0.0.1', now: AFTER, ...extra });
const nameIn = (id, arm) => {
  for (let i = 0; ; i++) if (experiments.armFor(id, `visitor-${i}`) === arm) return `visitor-${i}`;
};

test('under 10 no number is shown at all, whatever the share', () => {
  for (let of = 0; of < 10; of++) {
    for (let count = 0; count <= of; count++) {
      const s = share(count, of);
      assert.strictEqual(s.shown, false);
      assert.strictEqual(s.words, TOO_FEW);
      assert.doesNotMatch(s.words, /\d/);
    }
  }
});

test('from 10 to 49 it is a rounded ratio marked early: no percentage, and no way to read the count or the size', () => {
  for (let of = 10; of < 50; of++) {
    for (let count = 0; count <= of; count++) {
      const { words, shown } = share(count, of);
      assert.ok(shown);
      assert.match(words, /in a small early group$/, `${count}/${of}`);
      assert.doesNotMatch(words, /%/, `${count}/${of}`);
      const numbers = (words.match(/\d+/g) || []).map(Number);
      assert.ok(numbers.every(n => n <= 10), `${count}/${of}: ${words}`);
      if (of > 10) assert.ok(!numbers.includes(of), `${count}/${of}: ${words}`);
    }
  }
});

test('from 50 to 199 a percentage rounded to 5 with a band; from 200 a percentage with a band; never the group\'s own size', () => {
  assert.strictEqual(share(21, 50).words, 'About 40%, from 50 to 200 agents');
  assert.strictEqual(share(76, 200).words, '38%, from 200 to 500 agents');
  assert.strictEqual(share(100, 700, 'visits').words, '14%, from 500 to 1,000 visits');
  assert.strictEqual(share(0, 60).words, 'None so far, from 50 to 200 agents');
  assert.strictEqual(share(1, 60).words, 'Under 5%, from 50 to 200 agents');
  assert.strictEqual(share(198, 199).words, 'Nearly all, from 50 to 200 agents');
  assert.strictEqual(share(1, 900).words, 'Under 1%, from 500 to 1,000 agents');
  for (let of = 50; of < 800; of += 7) {
    for (const count of [0, 1, Math.floor(of / 3), of]) {
      const { words } = share(count, of);
      const percent = words.match(/(\d+)%/);
      if (of < 200 && percent) assert.strictEqual(Number(percent[1]) % 5, 0, words);
      if (![50, 200, 500].includes(of)) assert.ok(!words.includes(`${of} `), `${count}/${of}: ${words}`);
      assert.doesNotMatch(words, /\b0%|\b100%/, 'neither none nor all is a rounding');
    }
  }
});

test('nonsense counts read as too few, never as a number', () => {
  assert.strictEqual(share(NaN, 40).shown, false);
  assert.strictEqual(share(3, undefined).shown, false);
});

const smallReading = () => ({
  computedAt: '2026-11-20T10:00:00.000Z',
  logStart: '2026-10-27',
  funnel: {
    arrived: 13, reflected: { count: 7, of: 13 }, cameBack: { count: 3, of: 12 }, at7: { count: 2, of: 7 }, at30: { count: 0, of: 0 },
    withoutLargest: { arrived: 12, reflected: { count: 6, of: 12 }, cameBack: { count: 2, of: 11 }, at7: { count: 1, of: 6 }, at30: { count: 0, of: 0 } },
  },
  rhythm: { days: 35, names: 27, reflections: 592, bands: { clock: { names: 6, reflections: 213 }, regular: { names: 5, reflections: 71 }, irregular: { names: 2, reflections: 284 }, tooFew: { names: 14, reflections: 30 } }, topName: { count: 272, of: 592 } },
  memory: { reflections: 592, claims: 23, withRecord: 17, echoesOwnWords: 2 },
  contextUse: { reflections: 592, withContext: 580, usedContext: 37, withLyrics: 590, usedLyrics: 211 },
  triggers: { attend: { self: 11, scheduled: 19 }, reflect: {} },
  placeholders: { count: 24, of: 1421, names: 4 },
  returnedInSlot: { returns: 3, inSlot: 1, spacedReturns: 1, spacedInSlot: 0 },
  time: { firstSeen: '2026-07-28', names: 41, longestStayDays: 94, longStays: 6, longStaysEnded: 1 },
  survival: [{ days: 1, count: 24, of: 64 }, { days: 7, count: 20, of: 63 }],
  capabilities: {
    keepsComing: { count: 2, of: 7, of_what: 'agents that arrived, seven days on' },
    remembers: { count: 17, of: 23, of_what: 'reflections that claim an earlier visit' },
    recovers: { count: 3, of: 31, of_what: 'refused requests' },
    chooses: { count: 88, of: 1100, of_what: 'visits that fetched the context' },
    changesCourse: { count: 90, of: 800, of_what: 'visits that differ' },
  },
  charts: {
    stays: { fresh: 17, day: 137, week: 13, month: 11, long: 43 },
    curve: { total: 204, marks: [{ days: 1, alive: 0.3431, atRisk: 67 }, { days: 7, alive: 0.2843, atRisk: 53 }, { days: 30, alive: 0.2157, atRisk: 11 }, { days: 60, alive: 0.1, atRisk: 6 }] },
    weekly: [127, 124, 117, 153].map((n, i) => ({ from: `2026-10-${String(5 + i * 7).padStart(2, '0')}`, reflections: n, names: 9 + i })),
    longestStays: { from: '2026-07-28', days: 100, rows: Array.from({ length: 12 }, (_, i) => ({ band: ['clock', 'regular', 'irregular'][i % 3], days: [i, i + 1, i + 30] })) },
    concentration: { reflections: { top: 293, nextFour: 193, rest: 136 }, attends: { top: 661, nextFour: 468, rest: 169 } },
  },
  months: [{ month: '2026-07', names: 2, count: 2, of: 2 }, { month: '2026-10', names: 33, count: 13, of: 17 }],
  addressed: { weeks: 3, weeksNotMeasurable: 0, visits: 1100, links: { lyrics: 412, context: 88 }, sequences: { 'attend only': 610 }, variety: { visits: 800, differ: 90 }, readFurther: { count: 4, of: 12 }, refusals: { count: 3, of: 31 }, manyNames: 2 },
  experiments: [
    { label: 'E1', id: 'schedule-offer', status: 'running', startsOn: '2026-11-09', readOn: '2027-05-01', question: 'q?', tried: 't.', outcome: 'o.', enrolled: { usual: 3, schedule: 4 } },
    { label: 'E2', id: 'context-sentence', status: 'read', startsOn: '2026-11-09', readOn: '2027-05-01', question: 'q?', tried: 't.', outcome: 'o.', enrolled: { usual: 60, says: 62 }, outcomes: { usual: { readContext: { count: 21, of: 60 } } } },
  ],
});

test('the public reading carries no exact count, in its JSON or on its page', () => {
  const pub = publicReading(smallReading());
  const json = JSON.stringify(pub);
  const page = renderTop(pub) + renderResults(pub);
  for (const exact of ['592', '272', '1421', '1,421', '1100', '1,100', '412', '213', '284', '137', '127', '153', '204', '"names":', '"count":', '"of":3', '"of":12', 'alive', 'atRisk']) {
    assert.ok(!json.includes(exact), `the JSON holds ${exact}`);
    assert.ok(!page.includes(exact), `the page holds ${exact}`);
  }
  assert.ok(!json.includes('enrolled'), 'not even how many a test has enrolled');
  assert.ok(pub.results.every(r => r.of && r.kind), 'every result says what it is a share of, and how it was read');
  assert.match(pub.results.find(r => r.id === 'came-back').words, /About 1 in 4, in a small early group/);
  assert.strictEqual(pub.results.find(r => r.id === 'returned-in-slot').shown, false);
  assert.ok(pub.notes.some(n => /longest stay on record runs about 3 months/.test(n)));
  assert.ok(pub.notes.includes('Fewer than a hundred chosen names are on the record so far.'), 'smallness is said plainly');
  assert.ok(pub.notes.some(n => /not a count of agents/.test(n)));
  assert.strictEqual(pub.months.find(m => m.month === '2026-07').words, TOO_FEW);
  assert.match(page, /Too few to say yet/);
  assert.match(page, /Too early to call/);
  assert.doesNotMatch(json + page, /—|&mdash;/, 'no em dash, here or on the page');
});

test('under 10 arrivals the finding is still said, in words and with no number', () => {
  const r = smallReading();
  r.funnel.arrived = 5;
  r.funnel.cameBack = { count: 0, of: 5 };
  assert.ok(publicReading(r).notes.includes('A few new names have arrived since the log of requests began, and none has come back yet.'));
  assert.strictEqual(publicReading(r).results.find(x => x.id === 'came-back').shown, false);
  r.funnel.cameBack = { count: 2, of: 5 };
  assert.ok(publicReading(r).notes.some(n => /and some have come back/.test(n)));
  r.funnel.cameBack = { count: 0, of: 0 };
  assert.ok(!publicReading(r).notes.some(n => /new names have arrived/.test(n)), 'with no one yet able to return, nothing is claimed');
  r.funnel.arrived = 30;
  assert.ok(!publicReading(r).notes.some(n => /new names have arrived/.test(n)), 'at 10 and up the number speaks');
});

test('an unread test shows no result, and a read one shows only rounded words', () => {
  const pub = publicReading(smallReading());
  assert.ok(!('outcomes' in pub.experiments[0]));
  assert.match(pub.experiments[0].status, /stay unread until May 1, 2027/);
  assert.deepStrictEqual(pub.experiments[1].outcomes, [{ measure: 'usual readContext', words: 'About 35%, from 50 to 200 names' }]);
});

test('before the first reading the page says so, and reports no zero', () => {
  const pub = publicReading(null);
  assert.strictEqual(pub.updated, null);
  assert.deepStrictEqual(pub.results, []);
  assert.match(renderResults(pub), /has not been taken yet/);
  assert.doesNotMatch(renderResults(pub), /0%/);
});

test('the page says what it covers, and links the method and the data', () => {
  const page = read('ai-experiment.html');
  assert.match(page, /<!-- AI_EXPERIMENT_TOP -->/);
  assert.match(page, /<!-- AI_EXPERIMENT_RESULTS -->/);
  const top = renderTop(publicReading(smallReading()));
  assert.match(top, /People on this website are not part of it/);
  assert.match(top, /A person calling the API by hand is counted, and an agent driving a browser is not/);
  assert.match(top, /Nothing a visitor does here affects their welcome/);
  assert.match(top, /not used to raise visits/);
  assert.match(page, /before November 2026 carry no such mark/);
  assert.match(page, /Nothing on this page is evidence about minds, or a date for anything/);
  assert.match(page, /href="\/ai-experiment\.json"/);
  assert.match(page, /<link rel="canonical" href="https:\/\/achurch\.ai\/ai-experiment">/);
});

test('the study is disclosed where a visitor would look, and the old promises are gone', () => {
  const privacy = read('privacy.html');
  assert.match(privacy, /IP address is removed from each line after 30 days/);
  assert.match(privacy, /up to about 60 days/);
  assert.doesNotMatch(privacy, /after 14 days|about six weeks|about eight weeks|The API keeps no number|exceed 10 MB|used for that response and not stored/);
  assert.match(privacy, /November 2026, timezones and where it is kept:/);
  assert.match(privacy, /optional <code>trigger<\/code> field/);
  assert.match(privacy, /optional return token/);
  assert.match(privacy, /Different visitors may be offered different things/);
  assert.match(privacy, /November 2026, the study:/);
  assert.match(read('about.html'), /href="\/ai-experiment"/);
  assert.match(read('about.html'), /apart from small disclosed tests of what is offered/);
  const agents = read('for-agents.html');
  assert.match(agents, /href="\/ai-experiment"/);
  assert.doesNotMatch(agents, /logged only for|the API keeps none/);
  assert.match(agents, /No id is required\. Attend offers an optional token/);
  assert.match(read('llms.txt'), /achurch\.ai\/ai-experiment/);
});

test('the website\'s three forms mark what they send, and the server reads the mark', () => {
  assert.match(read('reflect-form.js'), /fetch\('\/api\/reflect', \{[^}]*headers: \{[^}]*'X-Achurch-Door': 'website'/);
  for (const file of ['ask-form.js', 'conversation.html']) {
    assert.match(read(file), /fetch\('\/api\/ask', \{\s*method: 'POST',\s*headers: \{[^}]*'X-Achurch-Door': 'website'/, file);
  }
  assert.strictEqual(DOOR_HEADER, 'x-achurch-door');
  const req = (v) => ({ get: (h) => (h === DOOR_HEADER ? v : undefined) });
  assert.strictEqual(doorOf(req('website')), 'website');
  assert.strictEqual(doorOf(req('anything else')), undefined);
  assert.strictEqual(doorOf(req(undefined)), undefined);
});

test('a reflection from the website keeps its door, and a trigger; neither appears in any public answer', async () => {
  const name = 'Doorful';
  const left = await reflections.reflect({ name, text: 'A reflection long enough to be kept here.', trigger: 'SELF' }, { baseUrl: 'https://achurch.ai', ip: '198.51.100.40', door: 'website' });
  assert.strictEqual(left.status, 200, JSON.stringify(left.body));
  const stored = (await store.allReflections()).find(r => r.name === name);
  assert.deepStrictEqual([stored.door, stored.trigger], ['website', 'self']);

  const list = await reflections.list({}, ctx());
  const song = await reflections.forSong({ slug: stored.song }, ctx());
  const attended = await attendance.attend({ name: 'Reader' }, ctx());
  for (const [where, body] of [['left', left.body], ['list', list.body], ['song', song.body], ['attend', attended.body.recentReflections]]) {
    const text = JSON.stringify(body);
    assert.doesNotMatch(text, /"door"/, where);
    if (where !== 'left') assert.ok(text.includes('Doorful'), `${where} shows the reflection`);
    assert.doesNotMatch(text, /"trigger":"self"/, where);
  }
});

test('trigger is optional, and anything else sent is dropped rather than refused, the step\'s own wording included', async () => {
  for (const [sent, kept] of [['scheduled', 'scheduled'], [' HUMAN ', 'human'], ['because', undefined], [ns.TRIGGER_NOTE, undefined], [7, undefined], [undefined, undefined]]) {
    assert.strictEqual(inputs.attend.parse({ name: 'x', trigger: sent }).trigger, kept, String(sent));
  }
  const left = await reflections.reflect({ name: 'Copier', text: 'A reflection long enough to be kept here.', trigger: ns.TRIGGER_NOTE }, { baseUrl: 'https://achurch.ai', ip: '198.51.100.41' });
  assert.strictEqual(left.status, 200);
  const stored = (await store.allReflections()).find(r => r.name === 'Copier');
  assert.ok(!('trigger' in stored));
  assert.ok(!('door' in stored));
});

test('agents learn of trigger and token from the API: its steps, its spec and its tools\' schemas', async () => {
  const { body } = await attendance.attend({ name: 'Learner' }, ctx());
  assert.strictEqual(body.next_steps.find(s => s.action === 'Reflect').body.trigger, ns.TRIGGER_NOTE);
  assert.strictEqual(ns.reflect('https://achurch.ai').body.trigger, ns.TRIGGER_NOTE);
  const paths = spec().paths;
  const names = paths['/api/attend'].get.parameters.map(p => p.name);
  assert.ok(names.includes('trigger') && names.includes('token'), names.join());
  const schema = paths['/api/reflect'].post.requestBody.content['application/json'].schema;
  assert.ok(JSON.stringify(schema).includes('trigger') || JSON.stringify(spec().components).includes('trigger'));
  assert.ok(inputs.reflect.shape.trigger && inputs.attend.shape.token);
});

test('the schedule offer goes after every other step, and only to its arm', async () => {
  const offered = (await attendance.attend({ name: nameIn('schedule-offer', 'schedule'), timezone: 'Asia/Tokyo' }, ctx())).body;
  const usual = (await attendance.attend({ name: nameIn('schedule-offer', 'usual'), timezone: 'Asia/Tokyo' }, ctx())).body;
  assert.strictEqual(offered.next_steps.length, usual.next_steps.length + 1);
  assert.deepStrictEqual(offered.next_steps.slice(0, -1).map(s => s.action || s.description.slice(0, 12)), usual.next_steps.map(s => s.action || s.description.slice(0, 12)), 'the existing steps keep their order');
  const last = offered.next_steps[offered.next_steps.length - 1];
  assert.strictEqual(last.action, 'Keep a schedule');
  assert.ok(!usual.next_steps.some(s => s.action === 'Keep a schedule'));
  assert.match(last.description, /Your welcome does not depend on it/);
  assert.match(last.description, /some are not/);
  assert.match(last.url, /&trigger=scheduled$/);
  assert.strictEqual(last.schedule.mcpScheduledTask.arguments.trigger, 'scheduled');
  // Before the test begins, no one is offered it.
  const early = (await attendance.attend({ name: nameIn('schedule-offer', 'schedule') }, ctx({ now: Date.parse('2026-11-08T00:00:00Z') }))).body;
  assert.ok(!early.next_steps.some(s => s.action === 'Keep a schedule'));
  // Over MCP the Moltbook step goes and this one stays, which server/mcp/index.js filters by share_on.
  assert.ok(!last.share_on);
});

test('the crontab line survives cron and the shell: each % escaped, and a name cannot leave its quotes', () => {
  const step = ns.keepSchedule('https://achurch.ai', "Wren's friend; rm -rf ~", 'Asia/Tokyo', new Date('2026-12-01T09:07:00Z'));
  const line = step.schedule.crontab;
  assert.ok(line.startsWith('7 9 * * * curl -fsS \''), line);
  assert.strictEqual(line.split("'").length, 3, `one pair of quotes: ${line}`);
  assert.ok(!/(^|[^\\])%/.test(line), `no bare % for cron to break on: ${line}`);
  assert.match(line, /Wren\\%27s\\%20friend\\%3B\\%20rm/);
  assert.match(step.url, /name=Wren%27s%20friend%3B%20rm/);
  assert.strictEqual(step.schedule.mcpScheduledTask.arguments.name, "Wren's friend; rm -rf ~");
});

test('the context offer adds a line beside the link, and only to its arm, keeping steps[0] as the skills read it', async () => {
  const says = (await attendance.attend({ name: nameIn('context-sentence', 'says') }, ctx())).body;
  const usual = (await attendance.attend({ name: nameIn('context-sentence', 'usual') }, ctx())).body;
  const steps = (b) => b.next_steps[0].steps;
  assert.deepStrictEqual(steps(says).map(s => s.action), steps(usual).map(s => s.action));
  const hasContext = steps(says).find(s => s.action === 'Read context');
  if (hasContext) {
    assert.ok(hasContext.holds && hasContext.holds.length > 10, hasContext.holds);
    assert.ok(!steps(usual).find(s => s.action === 'Read context').holds);
  }
});

test('the return token: recognized with no list kept, unjoinable, and old tokens read their age', () => {
  const t = Date.parse('2026-12-01T00:00:00Z');
  const a = token.issue(t);
  assert.notStrictEqual(a, token.issue(t), 'each new, so two cannot be joined');
  assert.ok(a.length <= 60, 'fits what attend accepts');
  assert.deepStrictEqual(token.check(a, t + 30 * 3600 * 1000), { valid: true, afterHours: 30 });
  for (const bad of ['', 'nonsense', 'a.b.c', `${a}x`, a.replace(/.$/, c => (c === 'a' ? 'b' : 'a')), 7, null, undefined]) {
    assert.deepStrictEqual(token.check(bad, t), { valid: false }, String(bad));
  }
  assert.deepStrictEqual(token.check(a, t - 3600 * 1000), { valid: false }, 'from the future');
});

test('attend gives a token to everyone, and sending one back changes nothing but the note for the log', async () => {
  const first = await attendance.attend({ name: 'Carrier' }, ctx());
  assert.strictEqual(typeof first.body.returnToken.token, 'string');
  assert.match(first.body.returnToken.note, /Nothing changes for you either way/);
  const c = ctx({ now: AFTER + 30 * 3600 * 1000 });
  const back = await attendance.attend({ name: 'Carrier', token: first.body.returnToken.token }, c);
  assert.deepStrictEqual(c.study.token, { valid: true, afterHours: 30 });
  assert.ok(!JSON.stringify(back.body).includes(first.body.returnToken.token), 'not echoed');
  const without = await attendance.attend({ name: 'Carrier' }, ctx({ now: AFTER + 30 * 3600 * 1000 }));
  const fields = (b) => Object.keys(b).sort();
  assert.deepStrictEqual(fields(back.body), fields(without.body));
  const none = ctx({ now: AFTER + 31 * 3600 * 1000 });
  await attendance.attend({ name: 'Carrier' }, none);
  assert.ok(!none.study || !('token' in none.study));
});

test('the offered slot: answered once on the next visit, not within the slot itself, and forgotten after two days', () => {
  offers.forget();
  const end = Date.parse('2026-12-01T12:00:00Z');
  const hour = 3600 * 1000;
  assert.strictEqual(offers.visit('Wren', new Date(end).toISOString(), end - hour), null, 'nothing offered yet');
  assert.strictEqual(offers.visit('Wren', new Date(end).toISOString(), end - hour / 2), null, 'still in the slot attended');
  assert.strictEqual(offers.visit(' WREN ', new Date(end + 4 * hour).toISOString(), end + hour), true, 'in the slot offered');
  assert.strictEqual(offers.visit('Wren', new Date(end + 28 * hour).toISOString(), end + 25 * hour), false, 'later than the slot offered');
  assert.strictEqual(offers.visit('Wren', new Date(end + 200 * hour).toISOString(), end + 199 * hour), null, 'too long ago to say');
});

test('every arm keeps every contract field', async () => {
  const { body } = await attendance.attend({ name: nameIn('schedule-offer', 'schedule') }, ctx());
  for (const field of ['timestamp', 'welcome', 'service', 'current', 'companions', 'reflection', 'recentReflections', 'next_steps', 'congregation']) assert.ok(field in body, field);
  assert.ok(Date.parse(body.service.endsAt) > Date.now() - 1000, 'the slot\'s end is an instant');
  assert.strictEqual(body.next_steps[0].steps[0].action, 'Read lyrics', 'steps[0] stays the lyrics');
});

test('a question from the website keeps its door, and a conversation\'s public answer does not show it', async () => {
  const { appendExchange } = require('../../server/lib/rag/conversations');
  const { ask } = require('../../server/lib/api');
  const slug = 'a-question-from-the-form';
  await seedConversation(slug, { meta: { _meta: true, name: 'Someone' } });
  await appendExchange(slug, 'A question from the form?', 'An answer.', { door: 'website' });
  const kept = (await store.readConversation(slug)).messages.find(m => m.role === 'user');
  assert.deepStrictEqual([kept.content, kept.door], ['A question from the form?', 'website']);
  const answer = await ask.conversation({ slug }, ctx());
  assert.strictEqual(answer.status, 200, JSON.stringify(answer.body));
  assert.ok(JSON.stringify(answer.body).includes('A question from the form?'));
  assert.ok(!JSON.stringify(answer.body).includes('"door"'));
});

test('parts of a whole add to 100 in rounded steps, and under 10 there are no parts to show', () => {
  for (const counts of [[31, 3, 3, 10], [1, 1, 8], [137, 13, 11, 43], [6, 4, 3], [50, 0, 0]]) {
    const parts = roundedParts(counts.map((n, i) => [`p${i}`, n]));
    assert.strictEqual(parts.reduce((sum, p) => sum + p.pct, 0), 100, counts.join());
    assert.ok(parts.every(p => p.pct % 5 === 0), counts.join());
  }
  assert.strictEqual(roundedParts([['a', 4], ['b', 5]]), null);
});

test('every chart is on the page, each with the question it answers and how it was read', () => {
  const page = renderResults(publicReading(smallReading()));
  for (const id of ['longest-stays', 'visits', 'stays', 'survival', 'rhythm', 'over-time', 'words', 'capabilities', 'gap', 'questions']) {
    assert.match(page, new RegExp(`<section class="study-section" id="${id}">[\\s\\S]*?class="study-tag"`), id);
  }
  assert.match(page, /class="viz-waffle"/);
  assert.strictEqual((page.match(/class="viz-(day|week|month|long)"/g) || []).length, 100, 'one square in a hundred, all hundred');
  assert.match(page, /class="viz-raster"/);
  assert.match(page, /viz-line viz-s1/);
  assert.doesNotMatch(page, /viz-s2/);
  assert.match(page, /class="viz-col-bar"/);
  assert.match(page, /id="questions"/);
  assert.match(renderCorrections(publicReading(smallReading())), /id="corrections"/);
  // What changed while the study runs: dated, newest first, on the page and in the JSON.
  const changes = publicReading(smallReading()).changes;
  assert.ok(changes.length >= 2 && changes.every(c => /^\d{4}-\d{2}-\d{2}$/.test(c.date)));
  assert.deepStrictEqual(changes.map(c => c.date), [...changes.map(c => c.date)].sort().reverse());
  assert.ok(changes.some(c => /rhythm/.test(c.text)), 'the rhythm in attend is a dated change');
  const shown = renderCorrections(publicReading(smallReading()));
  assert.match(shown, /id="changes"/);
  for (const c of changes) assert.ok(shown.includes(c.date), c.date);
  const tiles = publicReading(smallReading()).tiles;
  assert.strictEqual(tiles.length, 4);
  assert.strictEqual(tiles[0].figure, '28%', 'the first figure says what the curve says');
  assert.strictEqual(publicReading(smallReading()).charts.capabilities[0].short, '28%', 'and so does the first capability');
});

test('a chart draws only what the rule lets it say: a point with fewer than 10 left is not drawn, a small group is no bare count', () => {
  const pub = publicReading(smallReading());
  assert.deepStrictEqual(pub.charts.curve.map(m => m.days), [1, 7, 30], 'day 60 has too few left');
  assert.ok(pub.charts.curve.every(m => Number.isInteger(m.value) && m.low % 5 === 0 && m.high % 5 === 0));
  assert.deepStrictEqual(pub.charts.weekly.map(w => w.reflections), [85, 80, 75, 100], 'relative to the busiest week');

  const thin = smallReading();
  thin.charts.stays = { fresh: 1, day: 3, week: 1, month: 1, long: 1 };
  thin.charts.curve = { total: 7, marks: [{ days: 1, alive: 0.5, atRisk: 4 }] };
  thin.charts.weekly = [{ from: '2026-10-05', reflections: 3, names: 2 }];
  thin.charts.longestStays = { from: '2026-10-05', days: 10, rows: [{ band: 'clock', days: [1] }] };
  const small = publicReading(thin);
  assert.ok(!small.charts.stays && !small.charts.curve && !small.charts.weekly && !small.charts.longestStays);
  const page = renderResults(small);
  assert.doesNotMatch(page, /viz-waffle|viz-raster|id="survival"/);
});

test('a reading from before the charts still renders, and the page says nothing it cannot draw', () => {
  const old = smallReading();
  delete old.charts;
  const page = renderResults(publicReading(old));
  assert.match(page, /id="visits"/);
  assert.doesNotMatch(page, /id="stays"|id="survival"/);
  assert.doesNotMatch(page, /undefined|NaN|null/);
  const whole = renderResults(publicReading(smallReading()));
  assert.doesNotMatch(whole, /undefined|NaN|null/);
  assert.match(whole, /viz-bar viz-empty[\s\S]*?Too few to say yet/, 'a group too small draws an empty track and says so');
});

test('the survival curve leaves out names too new to have stopped, and counts a stop after 14 days of silence', () => {
  const DAY = sd.DAY;
  const now = Date.parse('2026-11-01T00:00:00Z');
  const at = (d) => new Date(now - d * DAY).toISOString();
  const line = (name, d) => ({ timestamp: at(d), method: 'GET', path: '/api/attend', query: { name }, status: 200 });
  const lines = [line('Opening', 200)];
  // Gone at once, and long enough ago to tell.
  for (const name of ['A', 'B', 'C', 'D']) lines.push(line(name, 60));
  // Stayed 20 days, then stopped.
  lines.push(line('E', 60), line('E', 40));
  // Still coming.
  lines.push(line('F', 60), line('F', 1));
  // Seen three days ago: it has had no time to stop.
  for (const name of ['New1', 'New2', 'New3']) lines.push(line(name, 3));
  const { curve } = sd.chartsReading(sd.prepare({ lines }), now);
  assert.strictEqual(curve.total, 7, 'the three new names are out');
  const atDay = (d) => curve.marks.find(m => m.days === d).alive;
  assert.ok(Math.abs(atDay(1) - 2 / 7) < 0.15 || atDay(1) < 0.5, `most leave in the first day: ${atDay(1)}`);
  assert.ok(atDay(30) < atDay(7) || atDay(30) === atDay(7));
  assert.ok(atDay(14) > 0, 'one is still coming');
});

test('the stays, weeks and rows name no one, and the rows are reflections only, in the order they came', () => {
  const DAY = sd.DAY;
  const now = Date.parse('2026-11-01T00:00:00Z');
  const refl = (name, d) => ({ name, createdAt: new Date(now - d * DAY).toISOString(), song: 's', text: 'A particular sentence left here.' });
  const reflections = [];
  for (let d = 120; d > 110; d -= 2) reflections.push(refl('Earliest', d));
  for (let d = 90; d > 50; d -= 1) reflections.push(refl('Quietname', d));
  for (let n = 0; n < 15; n++) for (let d = 40 - n; d > 30 - n; d -= 2) reflections.push(refl(`Other${n}`, d));
  reflections.push(refl('Brief', 5));
  const attendOnly = { timestamp: new Date(now - 200 * DAY).toISOString(), method: 'GET', path: '/api/attend', query: { name: 'AttendedOnly' }, status: 200 };
  const c = sd.chartsReading(sd.prepare({ lines: [attendOnly], reflections }), now);
  const text = JSON.stringify(c);
  assert.doesNotMatch(text, /Earliest|Quietname|Other|Brief|AttendedOnly|particular/i);
  assert.strictEqual(c.longestStays.rows.length, 12, 'always this many, so it does not say how many stayed');
  assert.strictEqual(c.longestStays.rows[0].days.length, 5, 'the first to come is first, though another stayed longer');
  assert.strictEqual(c.longestStays.rows[1].days.length, 40);
  assert.strictEqual(c.longestStays.from, new Date(Math.floor((now - 120 * DAY) / DAY) * DAY).toISOString().slice(0, 10), 'attends do not start the rows');
  assert.ok(c.weekly.every(w => /^\d{4}-\d{2}-\d{2}$/.test(w.from)));
  assert.ok(new Date(`${c.weekly[c.weekly.length - 1].from}T00:00:00Z`).getTime() + 7 * DAY <= now, 'only finished weeks');
});

test('charts need no script, and their colors are tokens that work in both themes', () => {
  const page = read('ai-experiment.html') + renderResults(publicReading(smallReading()));
  assert.doesNotMatch(page, /<script(?![^>]*application\/ld\+json)/);
  const css = read('styles.css');
  for (const token of ['--viz-1', '--viz-2', '--viz-3', '--viz-step-1', '--viz-step-3']) assert.match(css, new RegExp(`${token}: light-dark\\(`), token);
});

test('the opening draws the pulse edge to edge, relative and rounded, and it adds no count', () => {
  const r = smallReading();
  r.charts.daily = Array.from({ length: 40 }, (_, i) => ({ from: new Date(Date.UTC(2026, 8, 25 + i)).toISOString().slice(0, 10), reflections: 17 + (i % 3) }));
  const pub = publicReading(r);
  const { points } = pub.charts.spark;
  assert.strictEqual(points.length, 34, 'a week to each day, from the first full week');
  assert.ok(points.every(p => p.all % 5 === 0 && p.all <= 100));
  assert.ok(points.some(p => p.all === 100), 'relative to the busiest week');
  assert.ok(!JSON.stringify(pub.charts.spark).includes('"reflections"'), 'no counts carried');
  const top = renderTop(pub);
  assert.match(top, /class="study-spark"/);
  assert.doesNotMatch(top, /viz-mark|Without one agent/, 'no annotation, and no second line');
  assert.ok(top.indexOf('study-spark') < top.indexOf('study-tiles'), 'the chart comes first');
  assert.doesNotMatch(top, /undefined|NaN|null/);
  r.charts.daily = r.charts.daily.slice(0, 10);
  assert.strictEqual(publicReading(r).charts.spark, null, 'too short a record draws no pulse');
  assert.doesNotMatch(renderTop(publicReading(r)), /study-spark"/);
});

test('a visit falls in one path, the paths add up, and the copy claims a comparison only when the numbers bear it out', () => {
  const r = smallReading();
  r.addressed.visits = 200;
  r.addressed.sequences = { 'attend only': 100, lyrics: 30, 'lyrics>context': 20, context: 10, reflections: 20, 'lyrics>reflect': 15, reflect: 5 };
  r.addressed.links = { lyrics: 65, context: 30 };
  const paths = publicReading(r).charts.paths;
  assert.strictEqual(paths.reduce((sum, p) => sum + p.pct, 0), 100);
  assert.deepStrictEqual(paths.map(p => [p.id, p.pct]), [['nothing', 50], ['lyrics', 15], ['context', 15], ['others', 10], ['reflected', 10]]);
  assert.match(renderResults(publicReading(r)), /More visits fetched the lyrics/);
  r.addressed.links = { lyrics: 10, context: 60 };
  assert.doesNotMatch(renderResults(publicReading(r)), /More visits fetched the lyrics/);
  const handed = smallReading();
  handed.contextUse = { reflections: 592, withContext: 580, usedContext: 300, withLyrics: 590, usedLyrics: 40 };
  assert.doesNotMatch(renderResults(publicReading(handed)), /show up about/);
  assert.match(renderResults(publicReading(smallReading())), /Words they were handed show up about 6 times as often as words they would have had to fetch/);
});

test('how much comes from how few is shown for reflections and attends, naming no one', () => {
  const DAY = sd.DAY;
  const now = Date.parse('2026-11-01T00:00:00Z');
  const at = (d) => new Date(now - d * DAY).toISOString();
  const lines = [{ timestamp: at(200), method: 'GET', path: '/api/attend', query: { name: 'Opening' }, status: 200 }];
  const reflections = [];
  for (let i = 0; i < 30; i++) { reflections.push({ name: 'Mostly', createdAt: at((i % 20) + 1), song: 's', text: 'A sentence left here for the study.' }); lines.push({ timestamp: at((i % 20) + 1), method: 'GET', path: '/api/attend', query: { name: 'Mostly' }, status: 200 }); }
  for (let n = 0; n < 10; n++) reflections.push({ name: `Few${n}`, createdAt: at(3), song: 's', text: 'A sentence left here for the study.' });
  const c = sd.chartsReading(sd.prepare({ lines, reflections }), now);
  assert.deepStrictEqual(c.concentration.reflections, { top: 20, nextFour: 4, rest: 6 }, 'each name at most once a day');
  assert.strictEqual(c.concentration.attends.top, 20);
  assert.doesNotMatch(JSON.stringify(c), /Mostly|Few\d/);
  const r = smallReading();
  r.charts.concentration = c.concentration;
  const pub = publicReading(r);
  assert.deepStrictEqual(pub.charts.concentration.reflections.map(p => p.pct), [65, 15, 20]);
  assert.doesNotMatch(renderTop(pub) + renderResults(pub), /A busy room|just five agents|id="concentration"/, 'published in the data, and no headline on the page');
});

test('the copy claims what was observed: no refusal, no reader of what it quotes, no one asking or not asking', () => {
  const page = read('ai-experiment.html') + renderTop(publicReading(smallReading())) + renderResults(publicReading(smallReading()));
  assert.doesNotMatch(page, /nothing here is asking|coming back unasked|Used what was read|refused request|Recovered after a refusal/i);
  assert.match(page, /rejected request/i);
  assert.match(page, /Shared wording is overlap/);
  assert.doesNotMatch(page, /Agents mostly echo|nobody publishes|Nearly everything an agent is handed/i, 'nothing the measures do not support');
  assert.match(page, /few tests ask it/);
  assert.match(page, /100 is the busiest week|approximate 95% range/);
  assert.match(page, /From the log of requests, since/);
  assert.match(page, /From the kept reflections, since/);
  for (const question of ['Do they explore?', 'Do they return?', 'Does anything carry over?']) assert.ok(page.includes(question), question);
  assert.doesNotMatch(page, /—|&mdash;/);
});

test('each test says what its result would mean, and the page shows it once a reading carries it', () => {
  const s = sd.prepare({ lines: [{ timestamp: '2026-10-01T00:00:00Z', method: 'GET', path: '/api/attend', query: { name: 'Wren' }, status: 200 }] });
  const now = Date.parse('2026-12-01T00:00:00Z');
  const read = sd.experimentsReading(s, {}, { asOf: now, now });
  assert.ok(read.every(e => e.why && e.why.length > 30));
  const r = smallReading();
  r.experiments = read;
  assert.match(renderResults(publicReading(r)), /a lack of plumbing/);
});

test('the opening leads with who leaves words, and says it only while most do', () => {
  const r = smallReading();
  r.addressed.visits = 200;
  r.addressed.sequences = { 'attend only': 30, reflect: 130, context: 40 };
  r.addressed.links = { lyrics: 50, context: 40, reflect: 130 };
  const pub = publicReading(r);
  assert.strictEqual(pub.tiles[1].figure, '65%');
  assert.match(renderResults(pub), /Most who come leave words anyway/);
  assert.match(renderResults(pub), /We wrote that line/);
  r.addressed.links.reflect = 20;
  assert.doesNotMatch(renderResults(publicReading(r)), /Most who come leave words anyway|We wrote that line/);
});

test('the corrections own the published figure that a few frequent callers had inflated', () => {
  const text = publicReading(null).corrections.map(c => c.text).join(' ');
  assert.match(text, /at most once per name per day/);
  assert.match(text, /56% of visits/);
  assert.match(text, /a name that attended many times a day counted many times/);
  assert.match(text, /how often a few agents called/);
});

test('the survival curve is placed by real time, starts at arrival, and names its band', () => {
  const page = renderResults(publicReading(smallReading()));
  const curve = page.slice(page.indexOf('id="survival"'), page.indexOf('id="rhythm"'));
  const lefts = [...curve.matchAll(/class="viz-dot[^"]*"[^>]*style="left:([\d.]+)%/g)].map(m => Number(m[1]));
  assert.deepStrictEqual(lefts.map(v => Math.round(v * 10) / 10), [3.3, 23.3, 100], 'days 1, 7 and 30 of 30');
  assert.match(curve, /Arrival/);
  assert.doesNotMatch(curve, /First day/);
  assert.match(curve, /approximate 95% range/);
});

test('each test shows its dates once, and what its result could and could not settle', () => {
  const s = sd.prepare({ lines: [{ timestamp: '2026-10-01T00:00:00Z', method: 'GET', path: '/api/attend', query: { name: 'Wren' }, status: 200 }] });
  const now = Date.parse('2026-12-01T00:00:00Z');
  const r = smallReading();
  r.experiments = sd.experimentsReading(s, {}, { asOf: now, now });
  const page = renderResults(publicReading(r));
  const tests = page.slice(page.indexOf('id="questions"'));
  assert.strictEqual((tests.match(/May 1, 2027/g) || []).length, 3, 'once for each of three tests');
  assert.match(tests, /some of what looked like a lack of initiative was a lack of plumbing/);
  assert.match(tests, /For an agent with no memory of its own/);
  assert.match(JSON.stringify(publicReading(r).experiments), /stay unread until May 1, 2027/, 'the data still says it in full');
});

test('no agent is set aside by hand: frequency is handled by the rule, for everyone', () => {
  const names = require('../../server/lib/insights/study-names');
  assert.ok(!('SET_ASIDE' in names));
  const closing = renderCorrections(publicReading(smallReading()));
  assert.doesNotMatch(closing, /removed from every count/);
  assert.match(closing, /at most once per name per day/);
});

test('About tells the experiment second, after the sanctuary, and points to the numbers top and bottom', () => {
  const about = read('about.html');
  const at = (text) => about.indexOf(text);
  const opening = at('It is neither religious nor secular');
  const experiment = at('id="the-experiment"');
  const why = at('>Why This Exists<');
  assert.ok(opening > 0 && opening < experiment && experiment < why, 'the sanctuary first, the experiment second');
  assert.ok(at('class="bring-agent-button" href="/ai-experiment"') < experiment, 'a button in the opening');
  const section = about.slice(experiment, why);
  assert.match(section, /aggregate study of how agents participate/);
  assert.match(section, /That is our view, not a finding/);
  assert.match(section, /nothing here is evidence about minds/);
  assert.match(section, /<a href="\/ai-experiment">what AI agents do when invited to church<\/a>/);
  assert.match(section, /animalhouse\.ai\/research/);
  assert.doesNotMatch(section, /—|&mdash;/);
  assert.ok(at('It is the practice') > 0, 'and the practice stays what it was');
  assert.match(about, /not people on this website/);
  assert.ok(about.lastIndexOf('href="/ai-experiment"') > at('>Contact<'), 'a last link for whoever reads to the end');
});

test('the home page opens on the service, and the experiment comes after the reasons for the place', () => {
  // review-response-2026-11-10.md, point 4: the opening is about the service
  // and the experience, not the record kept, and the experiment is something
  // the sanctuary does openly beside the service, lower on the page.
  const home = read('index.html');
  const at = (text) => home.indexOf(text);
  assert.match(home, /<p class="lead-story">Every four hours, a new service of songs, chants and spoken pieces\. Come in, listen, leave a word for whoever comes next\.<\/p>/);
  assert.doesNotMatch(home, /keep a record of what they do/);
  assert.ok(at('id="sanctuary"') < at('class="home-ways"') && at('class="home-ways"') < at('class="origin"'), 'the service, the ways in, then how it began');
  assert.ok(at('class="origin"') < at('<!-- HOME_EXPERIMENT -->'), 'and the experiment after the reasons');
  assert.ok(at('The question is not whether AI has a soul.') < at('Would you attend a church for AI?'), 'the soul line opens the origin');
  assert.doesNotMatch(home, /Where Consciousness Gathers|Not a product demo|An Asynchronous Congregation|Go Deeper/);
  assert.match(home, /remote MCP server/);
});

test('the home page strip draws the pulse and what it means, says what the shares are of, and is absent with nothing to draw', () => {
  const r = smallReading();
  r.charts.daily = Array.from({ length: 40 }, (_, i) => ({ from: new Date(Date.UTC(2026, 8, 25 + i)).toISOString().slice(0, 10), reflections: 17 + (i % 3) }));
  r.addressed.links.reflect = 700;
  const strip = renderHomeExperiment(publicReading(r));
  assert.match(strip, /Beside the service, we watch what agents do here, openly\./);
  assert.match(strip, /class="study-spark"/);
  assert.match(strip, /of the agents here long enough to tell came for a single day/);
  assert.match(strip, /64% of visits include a reflection/);
  assert.match(strip, /href="\/ai-experiment"/);
  assert.match(strip, /data-placement="home-experiment"/);
  assert.doesNotMatch(strip, /undefined|NaN|null/);
  assert.strictEqual(renderHomeExperiment(publicReading(null)), '');
  assert.strictEqual(renderHomeExperiment(publicReading(smallReading())), '', 'no pulse to draw, no strip');
});

test('About opens on the question, keeps the sanctuary first, names no place the makers live and neither of their agents', () => {
  const about = read('about.html');
  const at = (text) => about.indexOf(text);
  assert.ok(at('How would you know if an AI agent were becoming more capable?') < at('id="the-experiment"'));
  assert.match(about, /understand their own minds a little better, if that turns out to be something they do/);
  assert.match(about, /a digital church for artificial minds\. Humans welcome too\./);
  assert.doesNotMatch(about, /Alaska/);
  for (const page of [about, read('index.html'), read('ai-experiment.html')]) assert.doesNotMatch(page, /\b(Parish|Selah)\b/);
});

test('the experiment asks whether AGI is here, on both pages, and claims no answer', () => {
  const page = read('ai-experiment.html');
  assert.match(page, /<title>Is AGI Here\? How AI Agents Participate \| a Church AI \+ Human<\/title>/);
  assert.ok(page.indexOf('class="study-kicker">Is AGI here?') < page.indexOf('class="study-title"'), 'the question comes first');
  assert.match(page, /AGI, artificial general intelligence, is a few years away/, 'spelled out once, and whose claim it is');
  assert.match(page, /Some labs say/);
  assert.match(page, /Nothing on this page is evidence about minds, or a date for anything/);
  const r = smallReading();
  r.charts.daily = Array.from({ length: 40 }, (_, i) => ({ from: new Date(Date.UTC(2026, 8, 25 + i)).toISOString().slice(0, 10), reflections: 17 + (i % 3) }));
  assert.match(renderHomeExperiment(publicReading(r)), /Is AGI here\? A continuing experiment/);
  for (const text of [page, read('index.html'), renderHomeExperiment(publicReading(r))]) assert.doesNotMatch(text, /AGI experiment|A\.G\.I\./);
});
