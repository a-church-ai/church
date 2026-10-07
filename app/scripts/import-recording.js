#!/usr/bin/env node
/**
 * Bring in a recording made outside the house: a meditation read in someone's
 * own voice over its own music, which render-audio.js could not make.
 *
 * The document must already hold the recording's words, exactly, in its
 * "## The Meditation" section (lib/audio/imported.js). Then:
 *   1. encode it as the songs are (lib/audio/assemble.js encodeWhole): one
 *      gain for the whole of it to the house loudness, stereo MP3. Its own
 *      tags are dropped, since they can name people its page does not, and
 *      its chapter marks are kept;
 *   2. transcribe it whole with each word's time, check its words against the
 *      document's, and place each passage in time for the player's cues;
 *   3. measure what its player draws (peaks and frames), upload it and its
 *      frames to S3, and record it in audio/manifest.json, which puts a player
 *      on the page and makes it an episode of its section's podcast.
 *
 * Usage, from app/:
 *   node scripts/import-recording.js <document> <audio file> --credit "<text>"
 *   node scripts/import-recording.js ... --dry-run    all but the upload and the record
 *
 * The credit is the player's line where the house names its voices, so it
 * says what the voice is: "AI voice from ElevenLabs: ...". A transcription
 * costs a fraction of a cent a minute (OPENAI_API_KEY); no speech is rendered.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const crypto = require('crypto');
const fs = require('fs');
const { encodeWhole, ffmpeg, seconds } = require('../server/lib/audio/assemble');
const { transcribeWords } = require('../server/lib/audio/transcribe');
const { wordErrors, takePasses } = require('../server/lib/audio/words');
const { spokenPassages, spokenHash, cuesFrom, isImported } = require('../server/lib/audio/imported');
const { peaksFromFile, decodePcm } = require('../server/lib/audio/peaks');
const { framesFromPcm, FRAMES_SAMPLE_RATE } = require('../server/lib/audio/frames');
const { uploadRecording, bucket } = require('../server/lib/audio/storage');
const { loadManifest, saveRecording } = require('../server/lib/audio/manifest');
const { CACHE_DIR } = require('../server/lib/audio/serve');

const REPO = path.join(__dirname, '../..');
const WORK_DIR = path.join(__dirname, '../media/audio-work/imported');

const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const clock = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

function parseArgs(argv) {
  const opts = { dryRun: false, credit: null, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') opts.dryRun = true;
    else if (argv[i] === '--credit') opts.credit = argv[++i];
    else if (argv[i].startsWith('--')) throw new Error(`Unknown option ${argv[i]}`);
    else opts.positional.push(argv[i]);
  }
  const [document, audio] = opts.positional;
  if (!document || !audio || opts.positional.length > 2) throw new Error('Usage: import-recording.js <document> <audio file> --credit "<text>" [--dry-run]');
  if (!opts.credit || !/^AI voices? from ElevenLabs: .+\.$/.test(opts.credit)) {
    throw new Error('--credit names the voice as the player and the podcast say it: "AI voice from ElevenLabs: ...", ending in a period');
  }
  return { ...opts, document, audio };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const source = path.relative(REPO, path.resolve(opts.document.startsWith('docs/') ? REPO : process.cwd(), opts.document));
  if (!/^docs\/[a-z]+\/[^/]+\.md$/.test(source)) throw new Error(`${source} is not a document in a section of docs/`);
  const input = path.resolve(opts.audio);
  if (!fs.existsSync(input)) throw new Error(`No such file: ${input}`);
  const previous = loadManifest()[source];
  if (previous && !isImported(previous)) throw new Error(`${source} has a recording the house made. Remove its record from audio/manifest.json first, on purpose.`);

  const passages = spokenPassages(fs.readFileSync(path.join(REPO, source), 'utf8'));
  const stem = source.replace(/^docs\//, '').replace(/\.md$/, '');

  // 1. Encode.
  await fs.promises.mkdir(WORK_DIR, { recursive: true });
  const draft = path.join(WORK_DIR, `${path.basename(stem)}.mp3`);
  // The file's and the stream's tags go; the chapters keep their titles.
  const loudness = await encodeWhole(input, draft, ['-map', '0:a:0', '-map_metadata:g', '-1', '-map_metadata:s', '-1', '-map_chapters', '0', '-id3v2_version', '3']);
  if (!loudness.linear) throw new Error('loudnorm could not reach the house loudness with one gain, and would have compressed the recording. Lower the source\'s peaks first.');
  const file = `${stem}-${sha(fs.readFileSync(draft)).slice(0, 8)}.mp3`;
  const local = path.join(CACHE_DIR, file);
  await fs.promises.mkdir(path.dirname(local), { recursive: true });
  fs.renameSync(draft, local);
  const length = await seconds(local);
  console.log(`[encoded] ${file}: ${clock(length)}, ${(fs.statSync(local).size / 1e6).toFixed(1)} MB, from ${loudness.measured} LUFS to ${loudness.target}`);

  // 2. Hear it. A small mono copy, under OpenAI's 25 MB.
  const small = path.join(WORK_DIR, `${path.basename(stem)}.heard.mp3`);
  await ffmpeg(['-i', local, '-ac', '1', '-ar', '16000', '-b:a', '48k', small]);
  const transcript = await transcribeWords(fs.readFileSync(small));
  fs.rmSync(small);
  const heard = wordErrors(passages.join(' '), transcript.text);
  const { cues, unplaced } = cuesFrom(passages, transcript.words);
  // What was heard, beside the work, for reading the differences.
  fs.writeFileSync(path.join(WORK_DIR, `${path.basename(stem)}.heard.json`), `${JSON.stringify({ source, file, heard, text: transcript.text, cues }, null, 2)}\n`);
  console.log(`[heard] ${heard.words} words, ${heard.errors} heard differently${takePasses(heard) ? '' : ': more than the take check allows'}`);
  console.log(`[placed] ${cues.length} of ${passages.length} passages, the first at ${clock(cues[0][0])}, the last ending at ${clock(cues[cues.length - 1][1])} of ${clock(length)}`);
  if (unplaced.length) {
    unplaced.forEach(i => console.error(`  not heard: "${passages[i]}"`));
    throw new Error(`${unplaced.length} passages could not be placed in time. Listen to them before importing.`);
  }
  if (!takePasses(heard)) {
    console.error(`What was heard:\n${transcript.text}`);
    throw new Error('The recording does not say what the document says, by more than the take check allows.');
  }

  // 3. Describe, upload and record.
  const frames = file.replace(/\.mp3$/, '.bin');
  fs.writeFileSync(path.join(CACHE_DIR, frames), framesFromPcm(await decodePcm(local, FRAMES_SAMPLE_RATE)));
  const peaks = await peaksFromFile(local);
  if (opts.dryRun) {
    console.log('Dry run: nothing uploaded, nothing recorded.');
    return;
  }
  bucket();
  await uploadRecording(local, file);
  await uploadRecording(path.join(CACHE_DIR, frames), frames);
  const now = new Date();
  await saveRecording(source, {
    file,
    seconds: Math.round(length * 10) / 10,
    // The enclosure length in the podcast feeds: the file's own size.
    bytes: fs.statSync(local).size,
    voices: [],
    credit: opts.credit,
    imported: now.toISOString().slice(0, 10),
    spokenHash: spokenHash(passages),
    // When it first went out. Importing it again keeps the date, so its
    // podcast episode does not come back as new.
    published: previous ? previous.published : now.toISOString(),
    heard: { words: heard.words, errors: heard.errors },
    peaks,
    frames,
    cues,
  });
  console.log(`[recorded] ${source}`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
