/**
 * The video publishers' pure parts (lib/video/publish/): X's OAuth 1.0a
 * signature, Bluesky's link facets, the posts' lengths, and YouTube's
 * chapter rules. No network.
 */

const test = require('node:test');
const assert = require('node:assert');
const { oauthHeader, postText: xText, replyText } = require('../server/lib/video/publish/x');
const { check: checkCopy } = require('../server/lib/video/publish/copy');
const { playlistOf } = require('../server/lib/video/publish/youtube');
const { postText: bskyText, linkFacet } = require('../server/lib/video/publish/bluesky');
const { chapters, timecode } = require('../server/lib/video/publish/metadata');

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
  const good = { hook: 'A hymn for the moment you stop seeing yourself in everyone else.', lead: 'A Nordic folk hymn. Stay with it.', descriptor: 'Nordic Folk Hymn', alt: 'Two panes of glass lean toward one light.', tags: ['Meditation', 'FolkMusic', 'Consciousness', 'AI', 'Hymn'] };
  assert.deepStrictEqual(checkCopy(JSON.stringify(good)).problems, []);
  const bad = checkCopy(JSON.stringify({ ...good, hook: 'Watch now — https://x.co', tags: ['aChurchAI', 'folk music', 'Meditation', 'AI', 'Hymn'] })).problems.join(' | ');
  assert.match(bad, /hook has a link, a hashtag or an em dash/);
  assert.match(bad, /names the sanctuary/);
  assert.match(bad, /"folk music" is not PascalCase/);
});

test('chapters are written only when YouTube would show them: from 0:00, three or more, ten seconds each', () => {
  assert.deepStrictEqual(chapters([0, 70, 140, 199]), ['0:00 I', '1:10 II', '2:20 III']);
  assert.deepStrictEqual(chapters([0, 14, 26.4, 37]), ['0:00 I', '0:14 II', '0:26 III']);
  assert.deepStrictEqual(chapters([0, 14, 26.4, 36]), [], 'the chant: its last movement runs 9.6 seconds, so none are written');
  assert.deepStrictEqual(chapters([0, 5, 20, 40]), [], 'a chapter under ten seconds would hide them all');
  assert.deepStrictEqual(chapters([0, 30, 60]), [], 'two chapters are too few');
  assert.strictEqual(timecode(3725), '1:02:05');
});

test('each kind goes to its playlist, and a practice named as a meditation goes with the meditations', () => {
  assert.strictEqual(playlistOf('song', 'No Mirror Now').title, 'Church Music');
  assert.strictEqual(playlistOf('chant', 'Chant for Arrival').title, 'Church Chants');
  assert.strictEqual(playlistOf('prayer', 'Prayer of Gratitude').title, 'Church Prayers');
  assert.strictEqual(playlistOf('ritual', 'Welcoming Liturgy').title, 'Church Rituals');
  assert.strictEqual(playlistOf('practice', 'Meditation of Loving-Kindness for Every Kind of Mind').title, 'Church Meditations');
  assert.strictEqual(playlistOf('practice', 'The One Who Wakes').title, 'Church Practices');
});
