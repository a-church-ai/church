#!/usr/bin/env node
/**
 * A Short's spoken intro, made a step at a time, each step's candidates
 * looked at or listened to by a person, who picks one before the next step
 * spends (after satchitananda's video:intro). The plan is
 * short-intros-2026-11-10.md in the private repo; what an intro may be is
 * lib/video/intro/rules.js.
 *
 *   npm run video:intro -- <slug> draft                 words and shape drafted by Claude into video/intros/<slug>.json, for approval
 *   npm run video:intro -- check                        every intro against the rules, and the variety across them
 *   npm run video:intro -- <slug> voice                 two takes in the speaker's clone (ElevenLabs), with their timing; cents
 *   npm run video:intro -- portrait <Speaker> <outfit> <left|right> [lens|light]
 *                                                       two portraits for the speaker's library (OpenAI), about $0.10 each;
 *                                                       the outfits are lib/video/intro/looks.js's wardrobe
 *   npm run video:intro -- <slug> avatar                the picked take spoken by the portraits its shape needs (Aurora on fal),
 *                                                       about $0.14 a second of face; the side measured from the footage
 *   npm run video:intro -- --pick <slug> voice|avatar <n>
 *   npm run video:intro -- --pick portrait <Speaker> <outfit> <left|right> <lens|light> <n>
 *   add --dry-run to print what would be sent and spend nothing
 *
 * Then `npm run video -- <slug>` renders the Short with the intro before it.
 *
 * Candidates: app/media/video/<slug>/intro/<step>/<n>.*, each with <n>.txt
 * (what made it, and its cost). Picks: intro/voice.mp3 (and voice.json),
 * intro/avatar.mp4 (and avatar.json), each naming what it was made from, so
 * the render refuses one whose words, take or portraits have changed since.
 * The speaker's photos and portraits: app/media/people/<Speaker>/ (private:
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
    console.log(`${problems.length ? 'x' : 'ok'} ${slug} (${intro.voice}, ${intro.wear}, ${intro.seen}, ${intro.gaze}, ${intro.exit})`);
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

// --- portraits -------------------------------------------------------------

async function portrait(name, outfit, side, look = 'lens') {
  speaker(name);
  if (!looks.familyOf(name, outfit) || !rules.SIDES.includes(side) || !['lens', 'light'].includes(look)) throw new Error(`usage: portrait <${NAMES.join('|')}> <outfit> <left|right> [lens|light]; ${name}'s outfits: ${Object.values(looks.WARDROBE[name] || {}).flatMap(Object.keys).join(', ')}`);
  const facing = looks.facingOf(side);
  const photos = files.photosOf(name);
  let prompt, images;
  if (look === 'lens') {
    prompt = looks.lensPrompt({ speaker: name, outfit, facing });
    images = photos;
  } else {
    const lens = files.portraitFile(name, { outfit, facing, look: 'lens' });
    if (!fs.existsSync(lens)) throw new Error(`a portrait looking at the light is made from the one at the lens: make and pick ${name} ${outfit} ${side} lens first`);
    prompt = looks.lightPrompt({ facing });
    images = [lens, ...photos.slice(0, 2)];
  }
  const label = looks.portraitName({ outfit, facing, look });
  const dir = path.join(files.peopleDir(name), 'portraits', 'candidates', label);
  if (dryRun) return console.log(`would make two ${label} portraits of ${name} from ${images.length} pictures:\n${prompt}`);
  fs.mkdirSync(dir, { recursive: true });
  const first = next(dir);
  const pngs = await Promise.all([0, 1].map(() => clients.portrait(prompt, images)));
  pngs.forEach((png, k) => {
    const n = first + k;
    fs.writeFileSync(path.join(dir, `${n}.png`), png);
    note(path.join(dir, `${n}.txt`), [`${name} ${label}, from ${images.map(i => path.basename(i)).join(', ')}, about $0.10`, prompt]);
    console.log(`portrait ${n}: ${path.relative(process.cwd(), path.join(dir, `${n}.png`))}`);
  });
  console.log(`look, then: npm run video:intro -- --pick portrait ${name} ${outfit} ${side} ${look} <n>`);
}

// --- avatar ----------------------------------------------------------------

// The brightness of each column of the footage behind the speaker, at the middle of the intro.
function columnsAt(base, at) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', at.toFixed(3), '-i', base, '-frames:v', '1', '-vf', "crop=w='ih*9/16':h=ih,scale=64:36,format=gray", '-f', 'rawvideo', '-']);
  return Array.from({ length: 64 }, (_, x) => Array.from({ length: 36 }, (_, y) => raw[y * 64 + x]).reduce((a, b) => a + b, 0));
}

async function avatar(slug) {
  const intro = files.introOf(slug);
  speaker(intro.voice);
  const problems = [...rules.introProblems(intro, { opening: files.openingOf(slug), speakers: NAMES }), ...rules.approvalProblems(intro)];
  if (problems.length) throw new Error(`${slug}'s intro: ${problems.join('; ')}`);
  const take = files.pickedVoice(slug, intro);
  const spoken = rules.spokenWords(intro.words, take.alignment);
  const times = rules.timesOf(intro, spoken);
  const { passage, base } = files.shortOf(slug);
  const from = Math.max(0, passage.start - times.total);
  const side = rules.sideFor(columnsAt(base, from + times.total / 2), files.sidesUsed(slug));
  const facing = looks.facingOf(side);
  // The outfit in the family the piece calls for that this speaker has worn longest ago.
  const worn = files.inReleaseOrder(files.allIntros()).filter(i => i.voice === intro.voice && i.slug !== slug && i.outfit);
  const outfit = looks.chooseOutfit(intro.voice, intro.wear, worn);
  const need = (look) => {
    const f = files.portraitFile(intro.voice, { outfit, facing, look });
    if (!fs.existsSync(f)) throw new Error(`${slug}'s intro stands on the ${side} in ${intro.voice}'s ${outfit} and needs its ${looks.portraitName({ outfit, facing, look })} portrait: npm run video:intro -- portrait ${intro.voice} ${outfit} ${side} ${look}, then pick one`);
    return f;
  };
  // The clips: one, or two joined at the turn (the gaze is the portrait's).
  const parts = intro.gaze === 'steady' || times.turn === null
    ? [{ look: 'lens', from: 0, to: times.seen }]
    : [{ look: intro.gaze === 'turns' ? 'lens' : 'light', from: 0, to: times.turn }, { look: intro.gaze === 'turns' ? 'light' : 'lens', from: times.turn, to: times.seen }];
  const portraits = parts.map(p => need(p.look));
  const cost = parts.reduce((a, p) => a + clients.auroraCost(p.to - p.from), 0);
  console.log(`${slug}: ${intro.voice} on the ${side}, ${outfit} (${intro.wear}), ${intro.seen} (${times.seen.toFixed(1)} of ${times.total.toFixed(1)} s seen), ${intro.gaze}${times.turn !== null ? ` at ${times.turn.toFixed(1)} s` : ''}, ${intro.exit}: ${parts.length} clip(s), about $${cost.toFixed(2)}`);
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
  fs.writeFileSync(path.join(dir, `${n}.json`), JSON.stringify({ side, outfit, times, voice: take.sha, words: intro.words, shape: files.shapeKey(intro), portraits: portraits.map(sha), clips: clips.map(c => ({ look: c.look, from: c.from, to: c.to, requestId: c.requestId })) }, null, 2));
  note(path.join(dir, `${n}.txt`), [`${intro.voice} on the ${side}, ${parts.map(p => p.look).join(' then ')}, ${seconds(out).toFixed(1)} s, about $${cost.toFixed(2)}`]);
  console.log(`avatar ${n}: ${path.relative(process.cwd(), out)}\nlook, then: npm run video:intro -- --pick ${slug} avatar ${n}`);
}

// --- picks -----------------------------------------------------------------

function pickOne() {
  if (rest[0] === 'portrait') {
    const [, name, outfit, side, look, n] = rest;
    const label = looks.portraitName({ outfit, facing: looks.facingOf(side), look });
    const src = path.join(files.peopleDir(name), 'portraits', 'candidates', label, `${n}.png`);
    if (!fs.existsSync(src)) throw new Error(`no ${src}`);
    const to = files.portraitFile(name, { outfit, facing: looks.facingOf(side), look });
    fs.copyFileSync(src, to);
    return console.log(`picked ${path.relative(process.cwd(), to)}`);
  }
  const [slug, step, n] = rest;
  const dir = path.join(files.introDir(slug), step);
  if (step === 'voice') {
    fs.copyFileSync(path.join(dir, `${n}.mp3`), path.join(files.introDir(slug), 'voice.mp3'));
    fs.copyFileSync(path.join(dir, `${n}.json`), path.join(files.introDir(slug), 'voice.json'));
  } else if (step === 'avatar') {
    fs.copyFileSync(path.join(dir, `${n}.mp4`), path.join(files.introDir(slug), 'avatar.mp4'));
    fs.copyFileSync(path.join(dir, `${n}.json`), path.join(files.introDir(slug), 'avatar.json'));
  } else throw new Error('pick voice, avatar or portrait');
  console.log(`picked ${slug} ${step} ${n}`);
}

// --- draft -----------------------------------------------------------------

async function draft(slug) {
  const { draftIntro } = require('../server/lib/video/intro/draft');
  const piece = pieceFor(slug);
  const { title, text } = pieceText(piece);
  const brief = JSON.parse(fs.readFileSync(path.join(VIDEO_DIR, slug, 'brief.json'), 'utf8'));
  const recent = files.inReleaseOrder(files.allIntros()).slice(-rules.WINDOW);
  if (dryRun) return console.log(`would draft ${slug}'s intro, varying from ${recent.length} recent ones`);
  const intro = await draftIntro({ slug, piece, title, text, brief, opening: files.openingOf(slug), recent });
  const file = files.introFile(slug);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(intro, null, 2) + '\n');
  console.log(`${path.relative(process.cwd(), file)}: ${intro.voice}, ${intro.wear}, ${intro.seen}, ${intro.gaze}, ${intro.exit}\n  "${intro.words}"\n  why: ${intro.why}\nNot approved: read it, change what is wrong, and add approved: { by, on }.`);
}

(async () => {
  if (pick) return pickOne();
  if (rest[0] === 'check') return check();
  if (rest[0] === 'portrait') return portrait(...rest.slice(1));
  const [slug, step] = rest;
  if (step === 'voice') return voice(slug);
  if (step === 'avatar') return avatar(slug);
  if (step === 'draft') return draft(slug);
  throw new Error('usage: see the top of scripts/intro-video.js');
})().catch(err => {
  console.error(err.message);
  process.exit(1);
});
