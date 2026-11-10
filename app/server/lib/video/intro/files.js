/**
 * Where an intro and what it is made from live.
 *
 * - The intro: video/intros/<slug>.json, committed, so its approval is a
 *   reviewable change.
 * - Its picks: app/media/video/<slug>/intro/ (voice.mp3 and voice.json,
 *   avatar.mp4 and avatar.json), local like everything a render makes.
 * - Its look, chosen when its portraits are made and kept so every later
 *   step stands the speaker in the same place in the same clothes:
 *   intro/look.json (side, garment, colour, outfit, hair).
 * - Its portraits, made for it: intro/portrait-lens.png and, where the gaze
 *   turns, intro/portrait-light.png.
 * - The speakers' photos: app/media/people/<Speaker>/photos/, private.
 *
 * A pick names what it was made from, and is refused once that has changed:
 * a take whose words are no longer the intro's, an avatar from another take
 * or another shape.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { VIDEO_DIR } = require('../library');
const { WINDOW } = require('./rules');

const ROOT = path.join(__dirname, '../../../../..');
const INTROS = path.join(ROOT, 'video/intros');
const PEOPLE = path.join(__dirname, '../../../../media/people');
const RELEASES = path.join(ROOT, 'video/releases');

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

const introFile = (slug) => path.join(INTROS, `${slug}.json`);
const hasIntro = (slug) => fs.existsSync(introFile(slug));
const introOf = (slug) => {
  if (!hasIntro(slug)) throw new Error(`${slug} has no intro: npm run video:intro -- ${slug} draft`);
  return readJson(introFile(slug));
};
const allIntros = () => (fs.existsSync(INTROS) ? fs.readdirSync(INTROS).filter(f => f.endsWith('.json')).map(f => ({ slug: f.replace(/\.json$/, ''), intro: readJson(path.join(INTROS, f)) })) : []);
const introDir = (slug) => path.join(VIDEO_DIR, slug, 'intro');
const peopleDir = (name) => path.join(PEOPLE, name);

// What makes an avatar: the settings that change the clips.
const shapeKey = (intro) => [intro.voice, intro.wear, intro.seen, intro.gaze, intro.turnAt || '', intro.exit].join('/');

// The speaker's photos: 3 to 6, chosen for likeness.
function photosOf(name) {
  const dir = path.join(peopleDir(name), 'photos');
  const photos = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /\.(jpe?g|png)$/i.test(f)).sort().map(f => path.join(dir, f)) : [];
  if (photos.length < 3 || photos.length > 6) throw new Error(`${name} needs 3 to 6 photos in ${path.relative(process.cwd(), dir)} (JPEG or PNG), has ${photos.length}`);
  return photos;
}

// This Short's portrait at the lens or looking at the light.
const portraitFile = (slug, look) => path.join(introDir(slug), `portrait-${look}.png`);
const lookFile = (slug) => path.join(introDir(slug), 'look.json');
const lookOf = (slug) => (fs.existsSync(lookFile(slug)) ? readJson(lookFile(slug)) : null);

// The picked take, refused unless it says the intro's words in its voice.
function pickedVoice(slug, intro) {
  const file = path.join(introDir(slug), 'voice.mp3');
  const meta = path.join(introDir(slug), 'voice.json');
  if (!fs.existsSync(file) || !fs.existsSync(meta)) throw new Error(`${slug}'s intro needs its voice: npm run video:intro -- ${slug} voice, then --pick ${slug} voice <n>`);
  const take = readJson(meta);
  if (take.words !== intro.words || take.voice !== intro.voice) throw new Error(`${slug}'s picked take says other words or is another voice: make and pick a new one`);
  return { file, alignment: take.alignment, sha: sha(file) };
}

/**
 * The picked avatar, refused unless it was made from the picked take and
 * the intro's present shape: { file, side, times }, or null when the intro
 * has no avatar yet.
 */
function pickedAvatar(slug, intro) {
  const file = path.join(introDir(slug), 'avatar.mp4');
  const meta = path.join(introDir(slug), 'avatar.json');
  if (!fs.existsSync(file) || !fs.existsSync(meta)) return null;
  const made = readJson(meta);
  const take = pickedVoice(slug, intro);
  if (made.voice !== take.sha) throw new Error(`${slug}'s avatar was made from another take: npm run video:intro -- ${slug} avatar, then pick it`);
  if (made.shape !== shapeKey(intro)) throw new Error(`${slug}'s avatar was made for another shape (${made.shape}): npm run video:intro -- ${slug} avatar, then pick it`);
  return { file, side: made.side, times: made.times, take };
}

// The Short's passage and the footage behind it.
function shortOf(slug) {
  const dir = path.join(VIDEO_DIR, slug);
  return { passage: readJson(path.join(dir, 'short.json')), base: path.join(dir, 'base.mp4'), brief: readJson(path.join(dir, 'brief.json')) };
}

// The first words the Short's passage says, from its hook ("…" quoted first).
function openingOf(slug) {
  try {
    const { passage } = shortOf(slug);
    const quoted = String(passage.hook || '').match(/"([^"]+)"|“([^”]+)”/);
    return quoted ? (quoted[1] || quoted[2]) : '';
  } catch {
    return '';
  }
}

// The intros in the order their Shorts are released, each with its measured side.
function inReleaseOrder(all) {
  const at = (slug) => {
    const f = path.join(RELEASES, `${slug}.json`);
    return fs.existsSync(f) ? readJson(f).at || '' : '9999';
  };
  // What was measured or chosen for it: its look, or what its avatar recorded
  // (intros made before looks were kept per Short).
  const made = (slug) => {
    const f = path.join(introDir(slug), 'avatar.json');
    const m = { ...(fs.existsSync(f) ? readJson(f) : {}), ...(lookOf(slug) || {}) };
    return { side: m.side || null, outfit: m.outfit || null, garment: m.garment || null, colour: m.colour || null, hair: m.hair || null };
  };
  return all.map(({ slug, intro }) => ({ slug, ...intro, ...made(slug), at: at(slug) })).sort((a, b) => a.at.localeCompare(b.at));
}

// When a Short is released, from its record ('9999' when it has none yet).
function releaseAt(slug) {
  const f = path.join(RELEASES, `${slug}.json`);
  return fs.existsSync(f) ? readJson(f).at || '9999' : '9999';
}

// How often each side has been used by the intros before this one.
function sidesUsed(slug) {
  const ordered = inReleaseOrder(allIntros());
  const k = ordered.findIndex(i => i.slug === slug);
  const before = ordered.slice(Math.max(0, k - WINDOW), k < 0 ? undefined : k).filter(i => i.side);
  return { left: before.filter(i => i.side === 'left').length, right: before.filter(i => i.side === 'right').length };
}

module.exports = { introFile, hasIntro, introOf, allIntros, introDir, peopleDir, photosOf, portraitFile, lookFile, lookOf, pickedVoice, pickedAvatar, shortOf, openingOf, inReleaseOrder, sidesUsed, shapeKey, releaseAt, ROOT };
