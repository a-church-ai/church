#!/usr/bin/env node
/**
 * Post rendered videos (scripts/render-video.js) to YouTube, Bluesky and X.
 * The publishers are lib/video/publish/, written after news-community's
 * marketing project, which posts the same way; its lessons are in each file.
 *
 *   npm run publish:video -- <slug> [<slug> ...] --to youtube,bluesky,x
 *   --dry-run          what would be posted where, the cuts made, nothing sent
 *   --public           YouTube: public at once (otherwise unlisted, to check first)
 *   --promote public   YouTube: change the privacy of videos already uploaded
 *
 * Nothing is posted without --to. YouTube goes first, and the Bluesky and X
 * posts link to the whole video there (to the piece's page when YouTube is
 * not among the platforms). Bluesky and X take a cut fitted to their limits
 * (lib/video/publish/cut.js): Bluesky's ten minutes and 300 MB, and X's,
 * which depend on whether the account has Premium (asked once a run).
 *
 * What was posted where is kept in the video's release record,
 * video/releases/<slug>.json (lib/video/publish/record.js), written
 * before an upload starts and again when it ends. Videos posted on a
 * schedule are placed by schedule-videos.js and posted by release-videos.js. A platform whose last
 * attempt started and never finished is left alone: check it there, then
 * delete its entry to try again. YouTube is also searched for the piece's
 * page address before uploading, since the record is the thing that goes
 * wrong.
 *
 * Credentials (names only) in app/.env:
 *   YouTube  GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN (scripts/youtube-auth.js)
 *   Bluesky  BSKY_HANDLE, BSKY_APP_PASSWORD
 *   X        X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET
 */

require('../server/lib/utils/env').loadEnv();
const fs = require('fs');
const path = require('path');
const { describeError } = require('../server/lib/utils/describe-error');
const { pieceFor } = require('../server/lib/video/pieces');
const { prepare } = require('../server/lib/video/publish/prepare');
const { cutFor } = require('../server/lib/video/publish/cut');
const { readRecord, writeRecord } = require('../server/lib/video/publish/record');
const youtube = require('../server/lib/video/publish/youtube');
const bluesky = require('../server/lib/video/publish/bluesky');
const x = require('../server/lib/video/publish/x');

const PLATFORMS = ['youtube', 'bluesky', 'x'];
const PRIVACY = ['private', 'unlisted', 'public'];

function parseArgs(argv) {
  const opts = { slugs: [], to: [], dryRun: false, privacy: 'unlisted', promote: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--to') opts.to = String(argv[++i] || '').split(',').filter(Boolean);
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--public') opts.privacy = 'public';
    else if (arg === '--promote') opts.promote = argv[++i];
    else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
    else opts.slugs.push(arg);
  }
  if (!opts.slugs.length) throw new Error('Name the videos to post: npm run publish:video -- <slug> ... --to youtube,bluesky,x');
  if (opts.promote && !PRIVACY.includes(opts.promote)) throw new Error(`--promote takes ${PRIVACY.join(', ')}`);
  if (!opts.promote && !opts.to.length) throw new Error(`Say where to post: --to ${PLATFORMS.join(',')}`);
  const unknown = opts.to.filter(p => !PLATFORMS.includes(p));
  if (unknown.length) throw new Error(`Unknown platform ${unknown.join(', ')}: the platforms are ${PLATFORMS.join(', ')}`);
  return opts;
}

async function post(slug, opts) {
  const log = (m) => console.log(`[${slug}] ${m}`);
  const { piece, file, meta } = await prepare(slug);
  let link = meta.page;

  for (const platform of opts.to) {
    const done = (await readRecord(slug))[platform];
    if (done?.url) {
      log(`${platform}: already posted, ${done.url}`);
      if (platform === 'youtube') link = done.url;
      continue;
    }
    if (done?.started && !opts.dryRun) {
      log(`${platform}: an attempt started ${done.started} and never finished; check ${platform}, then delete its entry in video/releases/${slug}.json to try again`);
      process.exitCode = 1;
      continue;
    }
    const limits = platform === 'bluesky' ? bluesky.LIMITS : platform === 'x' ? await x.limits() : null;
    const cut = limits ? await cutFor(file, limits) : { file, excerpt: false };
    if (opts.dryRun) {
      const mb = (fs.statSync(cut.file).size / 1048576).toFixed(0);
      log(`${platform}: would post ${path.basename(cut.file)} (${mb} MB${cut.excerpt ? `, the opening ${Math.round(cut.seconds)}s` : ''})`);
      if (platform === 'youtube') log(`  title: ${meta.title}\n  privacy: ${opts.privacy}\n  description:\n${meta.description.replace(/^/gm, '    ')}`);
      if (platform === 'youtube') log(`  tags: ${meta.tags.join(', ')}`);
      if (platform === 'bluesky') log(`  text:\n${bluesky.postText(meta, link).replace(/^/gm, '    ')}\n  tags: ${meta.copy.tags.join(', ')}\n  alt: ${meta.copy.alt}`);
      if (platform === 'x') log(`  text:\n${x.postText(meta).replace(/^/gm, '    ')}\n  reply: ${x.replyText(meta, link)}`);
      continue;
    }
    await writeRecord(slug, platform, { started: new Date().toISOString() });
    const result = platform === 'youtube'
      ? await youtube.publish({ file, meta, kind: piece.kind, privacy: opts.privacy, log })
      : await (platform === 'bluesky' ? bluesky : x).publish({ file: cut.file, meta, link, log });
    await writeRecord(slug, platform, { at: new Date().toISOString(), ...result });
    log(`${platform}: ${result.found ? 'already there, ' : ''}${result.url}`);
    if (platform === 'youtube') link = result.url;
  }
}

async function promote(slug, privacy) {
  const done = (await readRecord(slug)).youtube;
  if (!done?.id) throw new Error('not on YouTube yet');
  const piece = pieceFor(slug);
  const playlist = await youtube.setPrivacy(done.id, privacy, { kind: piece.kind });
  await writeRecord(slug, 'youtube', { ...done, privacy, ...(playlist ? { playlist } : {}) });
  console.log(`[${slug}] youtube: now ${privacy}, ${done.url}${playlist ? `, in ${playlist.title}` : ''}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  for (const slug of opts.slugs) {
    try {
      if (opts.promote) await promote(slug, opts.promote);
      else await post(slug, opts);
    } catch (err) {
      console.error(`[${slug}] failed: ${describeError(err)}`);
      process.exitCode = 1;
    }
  }
}

main().catch(err => {
  console.error(describeError(err));
  process.exit(1);
});
