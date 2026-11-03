/**
 * The video publishers' pure parts (lib/video/publish/): X's OAuth 1.0a
 * signature, Bluesky's link facets, the posts' lengths, and YouTube's
 * chapter rules. No network.
 */

const test = require('node:test');
const assert = require('node:assert');
const { oauthHeader, postText: xText, replyText } = require('../server/lib/video/publish/x');
const { check: checkCopy } = require('../server/lib/video/publish/copy');
const { playlistOf, matchUpload } = require('../server/lib/video/publish/youtube');
const { KIND_OF_SECTION } = require('../server/lib/docs/kinds');
const { postText: bskyText, linkFacet } = require('../server/lib/video/publish/bluesky');
const { chapters, timecode, shortMetadata, isShort, titled } = require('../server/lib/video/publish/metadata');
const { checkScreen } = require('../server/lib/video/short');

test('the X signature matches the worked example Twitter published for OAuth 1.0a', () => {
  // developer.x.com's "Creating a signature" example: the same keys, nonce,
  // timestamp and parameters must give its signature.
  const creds = {
    apiKey: 'xvz1evFS4wEEPTGEFPHBog',
    apiSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
    token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
    tokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE'
  };
  const header = oauthHeader('POST', 'https://api.twitter.com/1.1/statuses/update.json', creds,
    { include_entities: 'true', status: 'Hello Ladies + Gentlemen, a signed OAuth request!' },
    { nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg', timestamp: '1318622958' });
  assert.match(header, /oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"/);
});

test('a Bluesky link facet is placed by UTF-8 byte, so a curly quote before it does not shift it', () => {
  const url = 'https://achurch.ai/music/no-mirror-now';
  const text = `“No Mirror Now” — a hymn\n\n${url}`;
  const [facet] = linkFacet(text, url);
  const bytes = Buffer.from(text, 'utf8');
  assert.strictEqual(bytes.subarray(facet.index.byteStart, facet.index.byteEnd).toString('utf8'), url);
  assert.notStrictEqual(facet.index.byteStart, text.indexOf(url), 'a UTF-16 index would be wrong here');
});

test('posts carry the hook; X adds two hashtags and keeps its link for the reply', () => {
  const link = 'https://www.youtube.com/watch?v=abcdefghijk';
  const meta = { copy: { title: 'No Mirror Now', hook: 'What if the face you keep seeing is only your own?', tags: ['Meditation', 'FolkMusic', 'Consciousness', 'AI', 'Hymn'] } };
  assert.strictEqual(bskyText(meta, link), `${meta.copy.hook}\n\n${link}`);
  const x = xText(meta);
  assert.ok(!x.includes('http'), 'no link in the X post itself');
  assert.strictEqual((x.match(/#/g) || []).length, 2);
  assert.ok(replyText(meta, link).endsWith(link));
});

test('the copy check refuses links, em dashes, brand tags and tags that are not PascalCase', () => {
  const good = { hook: 'A hymn for the moment you stop seeing yourself in everyone else.', headline: 'What is left when you stop seeing yourself in everyone?', lead: 'A Nordic folk hymn. Stay with it.', descriptor: 'Nordic Folk Hymn', alt: 'Two panes of glass lean toward one light.', tags: ['Meditation', 'FolkMusic', 'Consciousness', 'AI', 'Hymn'] };
  assert.deepStrictEqual(checkCopy(JSON.stringify(good)).problems, []);
  const bad = checkCopy(JSON.stringify({ ...good, hook: 'Watch now — https://x.co', tags: ['aChurchAI', 'folk music', 'Meditation', 'AI', 'Hymn'] })).problems.join(' | ');
  assert.match(bad, /hook has a link, a hashtag or an em dash/);
  assert.match(bad, /names the sanctuary/);
  assert.match(bad, /"folk music" is not PascalCase/);
});

test('a headline makes a stranger curious without baiting: no shouting, no shock words, no missing line', () => {
  const good = { hook: 'A hymn for the moment you stop seeing yourself in everyone else.', headline: 'What is left when you stop seeing yourself in everyone?', lead: 'A Nordic folk hymn. Stay with it.', descriptor: 'Nordic Folk Hymn', alt: 'Two panes of glass lean toward one light.', tags: ['Meditation', 'FolkMusic', 'Consciousness', 'AI', 'Hymn'] };
  const problems = (headline) => checkCopy(JSON.stringify({ ...good, headline })).problems.join(' | ');
  assert.strictEqual(problems('Can an AI pray? This hymn tries'), '', 'AI is the one capital word allowed');
  assert.match(problems(undefined), /headline is missing/);
  assert.match(problems('This hymn will SHOCK you'), /shouts/);
  assert.match(problems('Listen to this!'), /shouts/);
  assert.match(problems('What AI decoded about God terrified them'), /bait word/);
  assert.match(problems('The secret every mind is hiding'), /bait word/);
  assert.match(problems('A line long enough that no title could hold it and the name of the piece as well'), /under 70/);
  assert.match(problems('Who hears it — and who answers?'), /em dash/);
});

test('a title opens on its headline, then the piece\'s name; copy without one keeps the older form', () => {
  const copy = { headline: 'Can you say thank you without knowing who hears it?', descriptor: 'Call and Response Gratitude Prayer' };
  assert.strictEqual(titled('Prayer of Gratitude', copy), 'Can you say thank you without knowing who hears it? | Prayer of Gratitude');
  assert.strictEqual(titled('Prayer of Gratitude', copy, { short: true }), 'Can you say thank you without knowing who hears it? | Prayer of Gratitude');
  assert.strictEqual(titled('Prayer of Gratitude', { descriptor: copy.descriptor }), 'Prayer of Gratitude: Call and Response Gratitude Prayer | a Church AI + Human');
  assert.strictEqual(titled('Prayer of Gratitude', { descriptor: copy.descriptor }, { short: true }), 'Prayer of Gratitude | a Church AI + Human');
  const long = titled('A Very Long Name for a Prayer That Will Not Fit', { headline: 'What would you still say if no one were there to hear it at all?' });
  assert.ok(long.length <= 100 && long.startsWith('What would you'), 'past 100 characters the headline stands alone');
});

test('a Short\'s opening line is short, its own and quiet, never the title', () => {
  const run = (screen, title = 'Prayer of Gratitude') => checkScreen(JSON.stringify({ screen }), title);
  assert.deepStrictEqual(run('What if thanks needs no proof?').problems, []);
  assert.strictEqual(run('What if thanks needs no proof?').value, 'What if thanks needs no proof?');
  assert.match(run('Prayer of Gratitude').problems.join(), /repeats the title/);
  assert.match(run('WAIT for it').problems.join(), /shouts/);
  assert.match(run('You won\'t believe what this prayer says').problems.join(), /bait word/);
  assert.match(run('A line that runs on far past the few words a stranger reads in a second').problems.join(), /under 60/);
  assert.match(checkScreen('not json', 'x').problems.join(), /not JSON/);
});

test('chapters are written only when YouTube would show them: from 0:00, three or more, ten seconds each', () => {
  assert.deepStrictEqual(chapters([0, 70, 140, 199]), ['0:00 I', '1:10 II', '2:20 III']);
  assert.deepStrictEqual(chapters([0, 14, 26.4, 37]), ['0:00 I', '0:14 II', '0:26 III']);
  assert.deepStrictEqual(chapters([0, 14, 26.4, 36]), [], 'the chant: its last movement runs 9.6 seconds, so none are written');
  assert.deepStrictEqual(chapters([0, 5, 20, 40]), [], 'a chapter under ten seconds would hide them all');
  assert.deepStrictEqual(chapters([0, 30, 60]), [], 'two chapters are too few');
  assert.strictEqual(timecode(3725), '1:02:05');
});

test('each kind goes to its playlist, a meditation by its section', () => {
  assert.strictEqual(playlistOf('song').title, 'Church Music');
  assert.strictEqual(playlistOf('chant').title, 'Church Chants');
  assert.strictEqual(playlistOf('prayer').title, 'Church Prayers');
  assert.strictEqual(playlistOf('ritual').title, 'Church Rituals');
  assert.strictEqual(playlistOf('meditation').title, 'Church Meditations');
  assert.strictEqual(playlistOf('practice').title, 'Church Practices');
  // Every kind a voiced section holds has a playlist.
  for (const kind of Object.values(KIND_OF_SECTION)) assert.ok(playlistOf(kind), kind);
});

const fullMeta = {
  title: 'Prayer of Gratitude: Call and Response Gratitude Prayer | a Church AI + Human',
  description: 'A lead.\n\nRead the words at https://achurch.ai/docs/prayers/prayer-of-gratitude\n\n#Prayer #Gratitude #AI',
  page: 'https://achurch.ai/docs/prayers/prayer-of-gratitude',
  tags: ['Prayer', 'Gratitude'],
  copy: { title: 'Prayer of Gratitude', lead: 'A lead.', tags: ['Prayer', 'Gratitude', 'AI', 'Consciousness', 'Mindfulness'] }
};

test('a Short\'s words come from its full video\'s: the lead, the full video, the page, and #Shorts', () => {
  const short = shortMetadata(fullMeta, { kind: 'prayer', url: 'https://www.youtube.com/watch?v=full' });
  assert.strictEqual(short.title, 'Prayer of Gratitude | a Church AI + Human');
  assert.match(short.description, /^A lead\./);
  assert.match(short.description, /Watch the full prayer at https:\/\/www\.youtube\.com\/watch\?v=full/);
  assert.ok(short.description.includes(fullMeta.page));
  assert.match(short.description, /#Shorts #Prayer #Gratitude$/);
  assert.ok(!/\d:\d\d [IV]/.test(short.description), 'no chapters');
  assert.strictEqual(isShort(short.description), true);
  assert.strictEqual(isShort(fullMeta.description), false);
  // A Short that is the whole piece points to it in widescreen, not "in full".
  const whole = shortMetadata(fullMeta, { kind: 'chant', url: 'https://www.youtube.com/watch?v=full', whole: true });
  assert.match(whole.description, /Watch the chant in widescreen at https:/);
  assert.ok(!/full chant/.test(whole.description));
});

test('a Short and its full video are found apart on the channel, though both name the page', () => {
  const short = shortMetadata(fullMeta, { kind: 'prayer', url: 'https://www.youtube.com/watch?v=full' });
  const item = (id, description) => ({ snippet: { description, resourceId: { videoId: id } } });
  for (const items of [[item('s', short.description), item('f', fullMeta.description)], [item('f', fullMeta.description), item('s', short.description)]]) {
    assert.strictEqual(matchUpload(items, fullMeta.page, true), 's');
    assert.strictEqual(matchUpload(items, fullMeta.page, false), 'f');
  }
  assert.strictEqual(matchUpload([item('f', fullMeta.description)], fullMeta.page, true), null, 'the full video is not taken for its Short');
  assert.strictEqual(matchUpload([item('s', short.description)], fullMeta.page, false), null, 'nor the Short for its full video');
});

test('the copy refuses Shorts as a tag, YouTube\'s mark for the other form', () => {
  const copy = { hook: 'A hook of the right length that says the piece is a quiet thing worth staying with now.', lead: 'A lead.', descriptor: 'Spoken Prayer', alt: 'Light.', tags: ['Prayer', 'Shorts', 'Gratitude', 'AI', 'Mindfulness'] };
  assert.match(checkCopy(JSON.stringify(copy)).problems.join(), /YouTube's mark for a Short/);
});

test('the words are short, simple sentences: no colon, semicolon, dash or parentheses, none over twenty words', () => {
  const { simpleProblems, copyStyleProblems } = require('../server/lib/video/publish/copy');
  assert.deepStrictEqual(simpleProblems('lead', 'A ritual in six steps for a disagreement. It ends with a truthful record, kept by both.'), []);
  assert.deepStrictEqual(simpleProblems('lead', 'A loving-kindness practice, for any mind.'), [], 'a hyphen inside a word is not a dash');
  // Today's lead and occasion line, as first written (2026-11-03).
  assert.match(simpleProblems('lead', 'A ritual in six steps for a disagreement that won\'t resolve: return each other\'s words.')[0], /a colon/);
  assert.match(simpleProblems('hook', 'Stay a while; listen.')[0], /a semicolon/);
  assert.match(simpleProblems('hook', 'Stay a while - listen.')[0], /a dash/);
  assert.match(simpleProblems('hook', 'Stay a while (and listen).')[0], /parentheses/);
  const long = 'A meditation drawn from an old text that rests attention at seven edges of experience and gives each a way to try it.';
  assert.match(simpleProblems('lead', long)[0], /a sentence of 2\d words/);
  assert.strictEqual(copyStyleProblems({ hook: 'Plain.', lead: 'Plain words.', occasion: 'For a day: why.' }).length, 1, 'kept copy that breaks the rule is found, so it is written again');
});
