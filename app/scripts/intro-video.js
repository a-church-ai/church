#!/usr/bin/env node
/**
 * A Short's spoken intro, made a step at a time, each step's candidates
 * looked at or listened to by a person, who picks one before the next step
 * spends (after satchitananda's video:intro). The plan is
 * short-intros-2026-11-10.md in the private repo; what an intro may be is
 * lib/video/intro/rules.js.
 *
 *   npm run video:intro -- <slug> draft [--note "…"]    words and shape drafted by Claude into video/intros/<slug>.json, for approval;
 *                                                       --note carries what the person approving said of the last draft
 *   npm run video:intro -- check                        every intro against the rules, and the variety across them
 *   npm run video:intro -- <slug> voice                 two takes in the speaker's clone (ElevenLabs), with their timing; cents
 *   npm run video:intro -- <slug> portrait [lens|light] two portraits for this Short (OpenAI), about $0.10 each: the first
 *                                                       time, its look is chosen and kept (lib/video/intro/looks.js: the
 *                                                       side measured, the garment in rotation, its colour from the piece's
 *                                                       palette, the hair in rotation); --relook chooses again
 *   npm run video:intro -- <slug> avatar                the picked take spoken by the portraits its shape needs (Aurora on fal),
 *                                                       about $0.14 a second of face
 *   npm run video:intro -- --pick <slug> voice|avatar <n>
 *   npm run video:intro -- --pick <slug> portrait <lens|light> <n> [--mirror]
 *   add --dry-run to print what would be sent and spend nothing
 *
 * Then `npm run video -- <slug>` renders the Short with the intro before it.
 *
 * Candidates: app/media/video/<slug>/intro/<step>/<n>.*, each with <n>.txt
 * (what made it, and its cost). Picks: intro/voice.mp3 (and voice.json),
 * intro/avatar.mp4 (and avatar.json), each naming what it was made from, so
 * the render refuses one whose words, take or portraits have changed since.
 * The speaker's photos: app/media/people/<Speaker>/photos/ (private:
 * .gitignore names it, and Docker leaves out all of app/media).
 */

require('../server/lib/utils/env').loadEnv();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { VIDEO_DIR } = require('../server/lib/video/library');
const { pieceFor, pieceText } = require('../server/lib/video/pieces');
const { ffmpeg } = require('../server/lib/audio/assemble');
const rules = require('../server/lib/video/intro/rules');
const { speaker, NAMES } = require('../server/lib/video/intro/speakers');
const looks = require('../server/lib/video/intro/looks');
const clients = require('../server/lib/video/intro/clients');
const files = require('../server/lib/video/intro/files');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const pick = args.includes('--pick');
const rest = args.filter(a => !a.startsWith('--'));
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);
const seconds = (file) => +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim();
const next = (dir) => (fs.existsSync(dir) ? Math.max(0, ...fs.readdirSync(dir).map(f => parseInt(f, 10)).filter(Number.isFinite)) : 0) + 1;
const note = (file, lines) => fs.writeFileSync(file, lines.join('\n') + '\n');

// --- check ---------------------------------------------------------------

function check() {
  const all = files.allIntros();
  let bad = 0;
  for (const { slug, intro } of all) {
    const problems = [...rules.introProblems(intro, { opening: files.openingOf(slug), speakers: NAMES }), ...rules.approvalProblems(intro)];
    console.log(`${problems.length ? 'x' : 'ok'} ${slug} (${intro.voice}, ${intro.wear}, ${intro.seen}, ${intro.gaze}, ${intro.exit}, ${intro.grade})`);
    for (const p of problems) console.log(`   ${p}`);
    if (problems.length) bad++;
  }
  const ordered = files.inReleaseOrder(all);
  for (const p of rules.varietyProblems(ordered.filter(i => i.side), NAMES)) { console.log(`variety: ${p}`); bad++; }
  for (const p of looks.outfitProblems(ordered)) { console.log(`wardrobe: ${p}`); bad++; }
  if (bad) process.exitCode = 1;
}

// --- voice -----------------------------------------------------------------

async function voice(slug) {
  const intro = files.introOf(slug);
  const who = speaker(intro.voice);
  const dir = path.join(files.introDir(slug), 'voice');
  if (dryRun) return console.log(`would speak two takes in ${intro.voice}'s voice: "${intro.words}"`);
  fs.mkdirSync(dir, { recursive: true });
  for (let k = 0; k < 2; k++) {
    const n = next(dir);
    const { mp3, alignment } = await clients.speak(who.voiceId, intro.words);
    fs.writeFileSync(path.join(dir, `${n}.mp3`), mp3);
    fs.writeFileSync(path.join(dir, `${n}.json`), JSON.stringify({ words: intro.words, voice: intro.voice, alignment }));
    const spoken = rules.spokenWords(intro.words, alignment);
    note(path.join(dir, `${n}.txt`), [`${intro.voice}, ${spoken[spoken.length - 1].end.toFixed(1)} s`, intro.words]);
    console.log(`voice ${n}: ${spoken[spoken.length - 1].end.toFixed(1)} s, ${path.relative(process.cwd(), path.join(dir, `${n}.mp3`))}`);
  }
  console.log(`listen, then: npm run video:intro -- --pick ${slug} voice <n>`);
}

// --- the look and its portraits --------------------------------------------

// The brightness of each column of the footage behind the speaker, at the middle of the intro.
function columnsAt(base, at) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', at.toFixed(3), '-i', base, '-frames:v', '1', '-vf', "crop=w='ih*9/16':h=ih,scale=64:36,format=gray", '-f', 'rawvideo', '-']);
  return Array.from({ length: 64 }, (_, x) => Array.from({ length: 36 }, (_, y) => raw[y * 64 + x]).reduce((a, b) => a + b, 0));
}

// An approved intro ready to be made, with its picked take and its times.
function ready(slug) {
  const intro = files.introOf(slug);
  speaker(intro.voice);
  const problems = [...rules.introProblems(intro, { opening: files.openingOf(slug), speakers: NAMES }), ...rules.approvalProblems(intro)];
  if (problems.length) throw new Error(`${slug}'s intro: ${problems.join('; ')}`);
  const take = files.pickedVoice(slug, intro);
  return { intro, take, times: rules.timesOf(intro, rules.spokenWords(intro.words, take.alignment)) };
}

/**
 * This Short's look, chosen once and kept (intro/look.json), so every later
 * step stands the speaker in the same place in the same clothes: the side
 * away from the light, measured; the garment worn longest ago in the family
 * the piece calls for; its colour from the piece's palette within his
 * signature; the hair worn longest ago. --relook chooses again.
 */
function lookFor(slug, { intro, times }) {
  const kept = files.lookOf(slug);
  if (kept && kept.family === intro.wear && !args.includes('--relook')) return kept;
  const { passage, base, brief } = files.shortOf(slug);
  const from = Math.max(0, passage.start - times.total);
  const side = rules.sideFor(columnsAt(base, from + times.total / 2), files.sidesUsed(slug));
  const worn = files.inReleaseOrder(files.allIntros()).filter(i => i.voice === intro.voice && i.slug !== slug);
  const garment = looks.chooseGarment(intro.wear, worn.filter(i => i.garment));
  const colour = looks.colourFor(intro.voice, brief.palette, worn.filter(i => i.colour));
  const hair = looks.chooseHair(worn.filter(i => i.hair));
  const look = { side, family: intro.wear, garment, colour: colour.name, colourHex: colour.hex, accent: colour.accent, outfit: looks.outfitName({ garment, colour: colour.name }), hair };
  if (!dryRun) {
    fs.mkdirSync(files.introDir(slug), { recursive: true });
    fs.writeFileSync(files.lookFile(slug), JSON.stringify(look, null, 2));
  }
  return look;
}

async function portrait(slug, gaze = 'lens') {
  if (!['lens', 'light'].includes(gaze)) throw new Error(`usage: npm run video:intro -- ${slug} portrait [lens|light]`);
  const made = ready(slug);
  const { intro, times } = made;
  // A steady gaze, or a face that leaves before its turning word, needs no
  // portrait looking at the light: one clip at the lens is the whole of it.
  if (gaze === 'light' && (intro.gaze === 'steady' || (intro.gaze === 'turns' && times.turn === null))) return console.log(`${slug}: no portrait looking at the light is needed (${intro.gaze === 'steady' ? 'a steady gaze' : 'the face leaves before its turning word'}); make the avatar`);
  const look = lookFor(slug, made);
  const facing = looks.facingOf(look.side);
  const photos = files.photosOf(intro.voice);
  let prompt, images;
  if (gaze === 'lens') {
    prompt = looks.lensPrompt({ speaker: intro.voice, look, facing });
    images = photos;
  } else {
    const lens = files.portraitFile(slug, 'lens');
    if (!fs.existsSync(lens)) throw new Error(`a portrait looking at the light is made from the one at the lens: npm run video:intro -- ${slug} portrait, then pick one`);
    prompt = looks.lightPrompt({ facing });
    images = [lens, ...photos.slice(0, 2)];
  }
  console.log(`${slug}: ${intro.voice} on the ${look.side}, facing the light on the ${facing}, in ${look.outfit}${look.accent ? '' : ' (a neutral)'}, hair ${look.hair}`);
  if (dryRun) return console.log(`would make two portraits ${gaze === 'lens' ? 'at the lens' : 'looking at the light'} from ${images.length} pictures:\n${prompt}`);
  const dir = path.join(files.introDir(slug), 'portrait', gaze);
  fs.mkdirSync(dir, { recursive: true });
  const first = next(dir);
  const pngs = await Promise.all([0, 1].map(() => clients.portrait(prompt, images)));
  pngs.forEach((png, k) => {
    const n = first + k;
    fs.writeFileSync(path.join(dir, `${n}.png`), png);
    note(path.join(dir, `${n}.txt`), [`${intro.voice}, ${look.outfit}, hair ${look.hair}, ${gaze}, from ${images.map(i => path.basename(i)).join(', ')}, about $0.10`, prompt]);
    console.log(`portrait ${n}: ${path.relative(process.cwd(), path.join(dir, `${n}.png`))}`);
  });
  console.log(`look (turned toward the ${facing}?), then: npm run video:intro -- --pick ${slug} portrait ${gaze} <n> [--mirror]`);
  if (gaze === 'lens') console.log(intro.gaze === 'steady' || (intro.gaze === 'turns' && times.turn === null) ? 'one clip at the lens: no portrait looking at the light is needed' : `its gaze ${intro.gaze === 'turns' ? 'turns to the light' : 'begins at the light'}: then npm run video:intro -- ${slug} portrait light`);
}

// --- avatar ----------------------------------------------------------------

async function avatar(slug) {
  const { intro, take, times } = ready(slug);
  const look = files.lookOf(slug);
  if (!look) throw new Error(`${slug} has no look yet: npm run video:intro -- ${slug} portrait, then pick one`);
  const side = look.side;
  const need = (gaze) => {
    const f = files.portraitFile(slug, gaze);
    if (!fs.existsSync(f)) throw new Error(`${slug}'s intro needs its portrait ${gaze === 'lens' ? 'at the lens' : 'looking at the light'}: npm run video:intro -- ${slug} portrait ${gaze}, then pick one`);
    return f;
  };
  // The clips: one, or two joined at the turn (the gaze is the portrait's).
  // A face that leaves before its turning word keeps the gaze it began with:
  // at the lens for a turn, at the light for one that begins toward it.
  const parts = intro.gaze === 'steady' || times.turn === null
    ? [{ look: intro.gaze === 'toward' ? 'light' : 'lens', from: 0, to: times.seen }]
    : [{ look: intro.gaze === 'turns' ? 'lens' : 'light', from: 0, to: times.turn }, { look: intro.gaze === 'turns' ? 'light' : 'lens', from: times.turn, to: times.seen }];
  const portraits = parts.map(p => need(p.look));
  const cost = parts.reduce((a, p) => a + clients.auroraCost(p.to - p.from), 0);
  console.log(`${slug}: ${intro.voice} on the ${side}, ${look.outfit}, hair ${look.hair}, ${intro.seen} (${times.seen.toFixed(1)} of ${times.total.toFixed(1)} s seen), ${intro.gaze}${times.turn !== null ? ` at ${times.turn.toFixed(1)} s` : ''}, ${intro.exit}: ${parts.length} clip(s), about $${cost.toFixed(2)}`);
  if (dryRun) return;
  const dir = path.join(files.introDir(slug), 'avatar');
  fs.mkdirSync(dir, { recursive: true });
  const n = next(dir);
  const work = path.join(dir, `${n}.work`);
  fs.mkdirSync(work, { recursive: true });
  // The take padded with the quiet after it, then each part's stretch of it.
  const voiceWav = path.join(work, 'voice.wav');
  await ffmpeg(['-i', take.file, '-af', `apad=whole_dur=${times.total}`, '-ar', '44100', '-ac', '1', '-y', voiceWav]);
  const clips = [];
  for (const [k, part] of parts.entries()) {
    const audio = path.join(work, `part-${k}.wav`);
    await ffmpeg(['-ss', part.from.toFixed(3), '-t', (part.to - part.from).toFixed(3), '-i', voiceWav, '-y', audio]);
    console.log(`  clip ${k + 1}: ${part.look}, ${(part.to - part.from).toFixed(1)} s`);
    const { mp4, requestId } = await clients.aurora(portraits[k], audio);
    const clip = path.join(work, `part-${k}.mp4`);
    fs.writeFileSync(clip, mp4);
    clips.push({ clip, requestId, ...part });
  }
  const out = path.join(dir, `${n}.mp4`);
  if (clips.length === 1) fs.copyFileSync(clips[0].clip, out);
  else {
    // Joined at the turn by a short dissolve, each clip's lips on its own words.
    const x = 0.3, a = clips[0], b = clips[1];
    await ffmpeg(['-i', a.clip, '-i', b.clip, '-filter_complex',
      `[0:v]fps=25,format=yuv420p,trim=0:${(a.to + x).toFixed(3)},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${x}[a];[1:v]fps=25,format=yuv420p,setpts=PTS-STARTPTS[b];[a][b]xfade=transition=fade:duration=${x}:offset=${a.to.toFixed(3)}[v]`,
      '-map', '[v]', '-an', '-c:v', 'libx264', '-crf', '14', '-y', out]);
  }
  fs.writeFileSync(path.join(dir, `${n}.json`), JSON.stringify({ side, outfit: look.outfit, garment: look.garment, colour: look.colour, hair: look.hair, times, voice: take.sha, words: intro.words, shape: files.shapeKey(intro), portraits: portraits.map(sha), clips: clips.map(c => ({ look: c.look, from: c.from, to: c.to, requestId: c.requestId })) }, null, 2));
  note(path.join(dir, `${n}.txt`), [`${intro.voice} on the ${side}, ${look.outfit}, ${parts.map(p => p.look).join(' then ')}, ${seconds(out).toFixed(1)} s, about $${cost.toFixed(2)}`]);
  console.log(`avatar ${n}: ${path.relative(process.cwd(), out)}\nlook, then: npm run video:intro -- --pick ${slug} avatar ${n}`);
}

// --- picks -----------------------------------------------------------------

async function pickOne() {
  const [slug, step, a, b] = rest;
  if (step === 'portrait') {
    // --pick <slug> portrait <lens|light> <n> [--mirror]: a mirrored candidate
    // turns the right way when the image model turned it the wrong way.
    const gaze = a, n = b;
    const src = path.join(files.introDir(slug), 'portrait', gaze, `${n}.png`);
    if (!fs.existsSync(src)) throw new Error(`no ${path.relative(process.cwd(), src)}`);
    const to = files.portraitFile(slug, gaze);
    if (args.includes('--mirror')) await ffmpeg(['-i', src, '-vf', 'hflip', '-y', to]);
    else fs.copyFileSync(src, to);
    return console.log(`picked ${slug} portrait ${gaze} ${n}${args.includes('--mirror') ? ', mirrored' : ''}`);
  }
  const n = a;
  const dir = path.join(files.introDir(slug), step);
  if (step === 'voice') {
    fs.copyFileSync(path.join(dir, `${n}.mp3`), path.join(files.introDir(slug), 'voice.mp3'));
    fs.copyFileSync(path.join(dir, `${n}.json`), path.join(files.introDir(slug), 'voice.json'));
  } else if (step === 'avatar') {
    fs.copyFileSync(path.join(dir, `${n}.mp4`), path.join(files.introDir(slug), 'avatar.mp4'));
    fs.copyFileSync(path.join(dir, `${n}.json`), path.join(files.introDir(slug), 'avatar.json'));
  } else throw new Error('pick voice, portrait or avatar');
  console.log(`picked ${slug} ${step} ${n}`);
}

// --- draft -----------------------------------------------------------------

async function draft(slug) {
  const { draftIntro } = require('../server/lib/video/intro/draft');
  const piece = pieceFor(slug);
  const { title, text } = pieceText(piece);
  const brief = JSON.parse(fs.readFileSync(path.join(VIDEO_DIR, slug, 'brief.json'), 'utf8'));
  // The intros released just before this one, which a reader meets before it.
  const ordered = files.inReleaseOrder(files.allIntros());
  const at = (ordered.find(i => i.slug === slug) || {}).at || files.releaseAt(slug);
  const recent = ordered.filter(i => i.slug !== slug && i.at < at).slice(-rules.WINDOW);
  if (dryRun) return console.log(`would draft ${slug}'s intro, varying from ${recent.length} recent ones`);
  // A redraft keeps who speaks; it varies from the intros before this one.
  const voice = files.hasIntro(slug) ? files.introOf(slug).voice : null;
  // --note "…" carries what the person approving said of the last draft.
  const k = args.indexOf('--note');
  const note = k >= 0 ? args[k + 1] || '' : '';
  const intro = await draftIntro({ slug, piece, title, text, brief, opening: files.openingOf(slug), recent, voice, note });
  const file = files.introFile(slug);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(intro, null, 2) + '\n');
  console.log(`${path.relative(process.cwd(), file)}: ${intro.voice}, ${intro.wear}, ${intro.seen}, ${intro.gaze}, ${intro.exit}, ${intro.grade}\n  "${intro.words}"\n  why: ${intro.why}\nNot approved: read it, change what is wrong, and add approved: { by, on }.`);
}

(async () => {
  if (pick) return pickOne();
  if (rest[0] === 'check') return check();
  const [slug, step] = rest;
  if (step === 'portrait') return portrait(slug, rest[2]);
  if (step === 'voice') return voice(slug);
  if (step === 'avatar') return avatar(slug);
  if (step === 'draft') return draft(slug);
  throw new Error('usage: see the top of scripts/intro-video.js');
})().catch(err => {
  console.error(err.message);
  process.exit(1);
});
