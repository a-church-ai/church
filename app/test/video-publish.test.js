/**
 * The video publishers' pure parts (lib/video/publish/): X's OAuth 1.0a
 * signature, Bluesky's link facets, the posts' lengths, and YouTube's
 * chapter rules. No network.
 */

const test = require('node:test');
const assert = require('node:assert');
const { oauthHeader, postText: xText } = require('../server/lib/video/publish/x');
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

test('posts keep within each platform\'s length, cutting the line and never the link', () => {
  const link = 'https://www.youtube.com/watch?v=abcdefghijk';
  const meta = { short: { title: 'A Hymn for the One Who Doesn\'t Sing', line: 'word '.repeat(120).trim() + '.' } };
  const bsky = bskyText(meta, link);
  assert.ok([...bsky].length <= 300, `${[...bsky].length} characters`);
  assert.ok(bsky.endsWith(link));
  const x = xText(meta, link);
  assert.ok([...x.replace(link, 'x'.repeat(23))].length <= 280, 'X counts a link as 23 characters');
  assert.ok(x.endsWith(link));
});

test('chapters are written only when YouTube would show them: from 0:00, three or more, ten seconds each', () => {
  assert.deepStrictEqual(chapters([0, 70, 140, 199]), ['0:00 I', '1:10 II', '2:20 III']);
  assert.deepStrictEqual(chapters([0, 14, 26.4, 37]), ['0:00 I', '0:14 II', '0:26 III']);
  assert.deepStrictEqual(chapters([0, 14, 26.4, 36]), [], 'the chant: its last movement runs 9.6 seconds, so none are written');
  assert.deepStrictEqual(chapters([0, 5, 20, 40]), [], 'a chapter under ten seconds would hide them all');
  assert.deepStrictEqual(chapters([0, 30, 60]), [], 'two chapters are too few');
  assert.strictEqual(timecode(3725), '1:02:05');
});
