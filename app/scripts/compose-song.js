#!/usr/bin/env node
/**
 * Make a song with ElevenLabs Music from its own song.md.
 *
 * A song's file holds what it is: its style line (the lane, the voices, the
 * tempo) and its lyrics in sections, each marker naming the section and how
 * it is sung ("[Verse 2 - lower voice solo, the human voice]"). This builds a
 * composition plan from them, one chunk a section with the house's shared
 * sound (audio/house-sound.json `music`), a soft lead-in and a tail so the
 * song sits between spoken pieces; asks ElevenLabs for the song; writes it to
 * app/media/library/<slug>.mp3, where scripts/song-audio.js takes it from to
 * level and publish it; and transcribes it, to say how many of its words were
 * sung as written. The plan, the song's id and the check are kept beside the
 * audio (<slug>.compose.json).
 *
 * The lyrics are read and refused as the songwriter's are
 * (lib/song-generation/song-file.js sectionsOf, validateSong): ElevenLabs'
 * limits, and the house's no-em-dash rule.
 *
 * Usage, from app/:
 *   node scripts/compose-song.js the-gathering-hymn            make it
 *   node scripts/compose-song.js the-gathering-hymn --dry-run  the plan and its length, nothing spent
 *   node scripts/compose-song.js the-gathering-hymn --check    check a take already made
 */

const path = require('path');
require('../server/lib/utils/env').loadEnv();
const fs = require('fs');
const { MUSIC } = require('../server/lib/audio/house');
const { planFor } = require('../server/lib/audio/compose');
const { compose } = require('../server/lib/audio/elevenlabs');
const { transcribe } = require('../server/lib/audio/transcribe');
const { wordErrors } = require('../server/lib/audio/words');
const { parseSongFile } = require('../server/lib/music/song-content');
const { sectionsOf, validateSong } = require('../server/lib/song-generation/song-file');
const { MUSIC_DIR } = require('../server/lib/music/songs');

const LIBRARY_DIR = path.join(__dirname, '../media/library');
const clock = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

// How many of a song's words were sung as written: its take transcribed and
// compared, as the spoken takes are (lib/audio/words.js). Kept in its record.
async function check(slug, words) {
  const record = path.join(LIBRARY_DIR, `${slug}.compose.json`);
  const kept = fs.existsSync(record) ? JSON.parse(fs.readFileSync(record, 'utf8')) : {};
  const heard = await transcribe(fs.readFileSync(path.join(LIBRARY_DIR, `${slug}.mp3`)));
  const { words: total, errors } = wordErrors(words, heard);
  fs.writeFileSync(record, `${JSON.stringify({ ...kept, words: total, errors, heard }, null, 2)}\n`);
  return { total, errors, sung: Math.round((1 - errors / total) * 100) };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const checkOnly = args.includes('--check');
  const slugs = args.filter(a => !a.startsWith('--'));
  if (!slugs.length) throw new Error('Name the songs to make: node scripts/compose-song.js <slug> [--dry-run | --check]');

  const failures = [];
  for (const slug of slugs) {
    const file = path.join(MUSIC_DIR, slug, 'song.md');
    if (!fs.existsSync(file)) throw new Error(`No song.md for ${slug}`);
    const song = parseSongFile(fs.readFileSync(file, 'utf8'));
    const { ok, issues } = validateSong(song);
    if (!ok) throw new Error(`${slug}: ${issues.join('; ')}`);
    const plan = planFor(song);
    const seconds = plan.chunks.reduce((n, c) => n + c.duration_ms, 0) / 1000;
    const words = sectionsOf(song.lyrics).flatMap(s => s.lines).join(' ');
    console.log(`${slug}: ${plan.chunks.length} sections, ${clock(seconds)}, ${words.split(/\s+/).length} words`);
    if (dryRun) {
      for (const c of plan.chunks) console.log(`  ${c.text.split('\n')[0]} ${Math.round(c.duration_ms / 1000)}s: ${c.positive_styles.slice(-3).join(', ')}`);
      continue;
    }

    if (!checkOnly) {
      // The take and its record are kept first: they are paid for, and a
      // check that fails (a transcription key, a network) must not lose them.
      const { audio, songId } = await compose({ plan, model: MUSIC.model });
      fs.mkdirSync(LIBRARY_DIR, { recursive: true });
      fs.writeFileSync(path.join(LIBRARY_DIR, `${slug}.mp3`), audio);
      fs.writeFileSync(path.join(LIBRARY_DIR, `${slug}.compose.json`), `${JSON.stringify({ songId, model: MUSIC.model, composed: new Date().toISOString(), plan }, null, 2)}\n`);
      console.log(`[composed] ${slug}: ${(audio.length / 1e6).toFixed(1)} MB, song ${songId}`);
    }
    try {
      const { total, errors, sung } = await check(slug, words);
      console.log(`[checked] ${slug}: ${sung}% of its ${total} words as written (${errors} differing). Listen, then publish: npm run audio:songs`);
    } catch (err) {
      failures.push(`${slug}: not checked: ${err.message.split('\n')[0]}`);
      console.error(`[not checked] ${slug}: ${err.message.split('\n')[0]}. The take is kept; check it later with --check.`);
    }
  }
  if (failures.length) {
    console.error(`\n${failures.length} not checked:\n  ${failures.join('\n  ')}`);
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
