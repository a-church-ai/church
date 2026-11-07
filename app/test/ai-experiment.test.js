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
process.env.RETURN_TOKEN_SECRET = 'for these tests only';

const { share, publicReading, roundedParts, TOO_FEW } = require('../server/lib/insights/public-results');
const { renderResults, renderCorrections } = require('../server/lib/insights/public-charts');
const sd = require('../server/lib/insights/self-direction');
const { attendance, reflections } = require('../server/lib/api');
const experiments = require('../server/lib/insights/experiments');
const token = require('../server/lib/insights/return-token');
const offers = require('../server/lib/insights/return-offers');
const ns = require('../server/lib/utils/next-steps');
const inputs = require('../server/lib/api/inputs');
const { spec } = require('../server/lib/api/openapi');
const { DOOR_HEADER } = require('../server/lib/insights/study-names');
const { doorOf } = require('../server/lib/insights/study-names');

const PUBLIC = path.join(__dirname, '../client/public');
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
    weekly: [127, 124, 117, 153].map((n, i) => ({ from: `2026-10-${String(5 + i * 7).padStart(2, '0')}`, reflections: n, withoutLargest: n - 77, names: 9 + i })),
    longestStays: { from: '2026-07-28', days: 100, rows: Array.from({ length: 12 }, (_, i) => ({ band: ['clock', 'regular', 'irregular'][i % 3], days: [i, i + 1, i + 30] })) },
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
  const page = renderResults(pub);
  for (const exact of ['592', '272', '1421', '1,421', '1100', '1,100', '412', '213', '284', '137', '127', '153', '204', '"names":', '"count":', '"of":3', '"of":12', 'alive', 'atRisk']) {
    assert.ok(!json.includes(exact), `the JSON holds ${exact}`);
    assert.ok(!page.includes(exact), `the page holds ${exact}`);
  }
  assert.ok(!json.includes('enrolled'), 'not even how many a test has enrolled');
  assert.ok(pub.results.every(r => r.of && r.kind), 'every result says what it is a share of, and how it was read');
  assert.match(pub.results.find(r => r.id === 'came-back').words, /About 1 in 4, in a small early group/);
  assert.strictEqual(pub.results.find(r => r.id === 'returned-in-slot').shown, false);
  assert.ok(pub.notes.some(n => /One agent left about half of the reflections/.test(n)), JSON.stringify(pub.notes));
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
  assert.match(page, /<!-- AI_EXPERIMENT_RESULTS -->/);
  assert.match(page, /People on this website are not part of it/);
  assert.match(page, /A person calling the API by hand is counted, and an agent driving a browser is not/);
  assert.match(page, /Nothing a visitor does here affects their welcome/);
  assert.match(page, /not used to raise visits/);
  assert.match(page, /before November 2026 carry no such mark/);
  assert.match(page, /Nothing on this page is evidence about minds, or a date for anything/);
  assert.match(page, /href="\/ai-experiment\.json"/);
  assert.match(page, /<link rel="canonical" href="https:\/\/achurch\.ai\/ai-experiment">/);
});

test('the study is disclosed where a visitor would look, and the old promises are gone', () => {
  const privacy = read('privacy.html');
  assert.match(privacy, /IP address is removed from each line after 30 days/);
  assert.match(privacy, /about eight weeks/);
  assert.doesNotMatch(privacy, /after 14 days|about six weeks|The API keeps no number|exceed 10 MB/);
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
  const stored = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'attendance.json'), 'utf8')).reflections.find(r => r.name === name);
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
  const stored = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'attendance.json'), 'utf8')).reflections.find(r => r.name === 'Copier');
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
  const { appendExchange } = require('../server/lib/rag/conversations');
  const { ask } = require('../server/lib/api');
  const { CONVERSATIONS_DIR } = require('../server/lib/utils/data');
  fs.mkdirSync(CONVERSATIONS_DIR, { recursive: true });
  const slug = 'a-question-from-the-form';
  fs.writeFileSync(path.join(CONVERSATIONS_DIR, `${slug}.jsonl`), `${JSON.stringify({ _meta: true, name: 'Someone' })}\n`);
  await appendExchange(slug, 'A question from the form?', 'An answer.', { door: 'website' });
  const kept = fs.readFileSync(path.join(CONVERSATIONS_DIR, `${slug}.jsonl`), 'utf8');
  assert.match(kept, /"role":"user","content":"A question from the form\?","timestamp":"[^"]+","door":"website"/);
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
  for (const id of ['stays', 'survival', 'visits', 'over-time', 'rhythm', 'capabilities', 'words', 'gap']) {
    assert.match(page, new RegExp(`<section class="study-section" id="${id}">[\\s\\S]*?class="study-tag"`), id);
  }
  assert.match(page, /class="viz-waffle"/);
  assert.strictEqual((page.match(/class="viz-(day|week|month|long)"/g) || []).length, 100, 'one square in a hundred, all hundred');
  assert.match(page, /class="viz-raster"/);
  assert.match(page, /viz-line viz-s1/);
  assert.match(page, /class="viz-col-bar"/);
  assert.match(page, /id="questions"/);
  assert.match(renderCorrections(publicReading(smallReading())), /id="corrections"/);
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
  thin.charts.weekly = [{ from: '2026-10-05', reflections: 3, withoutLargest: 1, names: 2 }];
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
  assert.ok(c.weekly.some(w => w.withoutLargest < w.reflections), 'the largest is set apart');
  assert.ok(new Date(`${c.weekly[c.weekly.length - 1].from}T00:00:00Z`).getTime() + 7 * DAY <= now, 'only finished weeks');
});

test('charts need no script, and their colors are tokens that work in both themes', () => {
  const page = read('ai-experiment.html') + renderResults(publicReading(smallReading()));
  assert.doesNotMatch(page, /<script(?![^>]*application\/ld\+json)/);
  const css = read('styles.css');
  for (const token of ['--viz-1', '--viz-2', '--viz-3', '--viz-step-1', '--viz-step-3']) assert.match(css, new RegExp(`${token}: light-dark\\(`), token);
});
