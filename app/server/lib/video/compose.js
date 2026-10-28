/**
 * The video put together by ffmpeg, at 1920x1080 and 30 frames a second:
 *
 *   base     the movements' loops, each repeated through its part of the
 *            piece and crossfaded into the next where the piece itself turns
 *            (a pause, or a change in the music, on a bar line for a song),
 *            pushed in and brightened as the recording swells
 *   milkdrop butterchurn, screen-blended over the base
 *   mandala  the house's layer, screen-blended over that
 *   finish   a soft bloom, a slight chromatic split, a slow hue drift, grain
 *            and a vignette
 *   title    the piece's name and the site's (page-meta.js SITE_NAME), faded
 *            in over the opening and out again, drawn as the share cards are
 *            (og-cards.js), with their fonts
 *
 * with the recording, at its house level, as the sound.
 *
 * A Short (short.js) is the same at 1080x1920 over a passage: the base cut
 * from the middle of the full video's base footage, its own upright layers,
 * and in place of the title card its overlays: captions (captions.js), a
 * small title at the top and a closing line, each shown over its own time.
 */

const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const { ffmpeg, seconds: lengthOf } = require('../audio/assemble');
const { RESVG_FONTS, escapeXml } = require('../og-cards');
const { SITE_NAME } = require('../utils/page-meta');
const { lumaAt } = require('./checks');
const { onDisk } = require('./library');

const FPS = 30;
const LANDSCAPE = { width: 1920, height: 1080 };
const PORTRAIT = { width: 1080, height: 1920 };
const SIZE = `${LANDSCAPE.width}:${LANDSCAPE.height}`;
const CROSSFADE = 3;
// Work files (movement footage, the base layer, pingpong loops) are only the
// final encode's inputs: near-lossless at CRF 14, encoded fast.
const WORK = ['-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p'];

function wrap(text, width) {
  const lines = [];
  for (const word of text.split(/\s+/)) {
    const last = lines[lines.length - 1];
    if (last && (last + ' ' + word).length <= width) lines[lines.length - 1] = last + ' ' + word;
    else lines.push(word);
  }
  return lines;
}

// The piece's name over a line beneath it (the site's name, unless given),
// centred in a frame of `size`, narrower lines when it stands upright.
function titleCard(title, file, { size = LANDSCAPE, under = SITE_NAME } = {}) {
  const upright = size.height > size.width;
  const lines = wrap(title, upright ? 16 : 26);
  const fontSize = 92, lineHeight = 112;
  const cx = size.width / 2;
  const top = size.height / 2 - ((lines.length - 1) * lineHeight) / 2;
  const text = lines.map((l, i) => `<text x="${cx}" y="${top + i * lineHeight}" text-anchor="middle" font-family="Inter Display" font-weight="300" font-size="${fontSize}" fill="#ffffff" filter="url(#glow)">${escapeXml(l)}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}">
  <defs><filter id="glow" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="10" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
  ${text}
  <text x="${cx}" y="${top + (lines.length - 1) * lineHeight + 100}" text-anchor="middle" font-family="Inter" font-weight="400" font-size="34" letter-spacing="3" fill="#ffffff" fill-opacity="0.8">${escapeXml(under)}</text>
</svg>`;
  fs.writeFileSync(file, new Resvg(svg, { font: RESVG_FONTS }).render().asPng());
  return file;
}

// The loop as it plays: its motion evened (checks.js evenLoop), and played
// forward then backward when it does not close.
async function loopSource(clip) {
  const loop = onDisk(clip.even);
  if (clip.seamless) return loop;
  const source = loop.replace(/\.mp4$/, '.pingpong.mp4');
  if (!fs.existsSync(source)) {
    await ffmpeg(['-i', loop, '-filter_complex', `[0:v]scale=${SIZE},fps=${FPS},split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1[v]`, '-map', '[v]', ...WORK, source]);
  }
  return source;
}

/**
 * One movement's footage, from `start` for `seconds` of the piece, its loop
 * repeated. With a beat grid the loop is stretched to a whole number of bars
 * and its every cycle begins on a downbeat; without one, its first cycle
 * begins where the movement does.
 */
async function movementFootage(clip, { start, seconds, grid }, file) {
  const source = await loopSource(clip);
  const length = await lengthOf(source);
  const bars = grid ? Math.max(1, Math.round(length / grid.bar)) : 0;
  const cycle = grid ? bars * grid.bar : length;
  const anchor = grid ? grid.downbeat : start;
  const into = (((start - anchor) % cycle) + cycle) % cycle;
  await ffmpeg(['-stream_loop', '-1', '-i', source, '-vf',
    `setpts=(PTS-STARTPTS)*${(cycle / length).toFixed(6)},fps=${FPS},trim=start=${into.toFixed(3)}:duration=${seconds.toFixed(3)},setpts=PTS-STARTPTS,scale=${SIZE},setsar=1`,
    ...WORK, file]);
  return { file, bars, cycle };
}

/**
 * The loops' answer to the sound, as ffmpeg commands for each frame: a slight
 * push in and brightening as the recording swells, and for a song a kick on
 * each beat. Written for sendcmd, which drives the labelled crop and eq
 * filters (an unlabelled target binds to the first filter of its kind).
 */
function pulseCommands(envelope, file) {
  const lines = [];
  let last = '';
  envelope.forEach(({ env, pulse }, f) => {
    const zoom = 1 + 0.035 * Math.min(1, env) + 0.03 * pulse;
    const w = Math.round(1920 / zoom / 2) * 2, h = Math.round(1080 / zoom / 2) * 2;
    const brightness = (-0.03 + 0.07 * Math.min(1, env) + 0.06 * pulse).toFixed(3);
    const saturation = (1 + 0.2 * Math.min(1, env) + 0.15 * pulse).toFixed(3);
    const now = `${w} ${h} ${brightness} ${saturation}`;
    if (now === last) return;
    last = now;
    lines.push(`${(f / FPS).toFixed(4)} crop@pulse w ${w}, crop@pulse h ${h}, eq@pulse brightness ${brightness}, eq@pulse saturation ${saturation};`);
  });
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

/**
 * The base layer: each movement's loop through its part of the piece, the
 * movements crossfading at `edges` (the n + 1 times from movementEdges),
 * centred on each edge, then moved by the sound.
 */
async function baseFootage(clips, { edges, grid, envelope, dir }) {
  const file = path.join(dir, 'base.mp4');
  const n = clips.length;
  const seconds = edges[n];
  const half = CROSSFADE / 2;
  const parts = [];
  for (const [i, clip] of clips.entries()) {
    const from = i ? edges[i] - half : 0;
    const to = i < n - 1 ? edges[i + 1] + half : seconds;
    parts.push(await movementFootage(clip, { start: from, seconds: to - from + 0.2, grid }, path.join(dir, `movement-${i + 1}.mp4`)));
  }
  let graph = '', last = '[0:v]';
  for (let i = 1; i < n; i++) {
    graph += `${last}[${i}:v]xfade=transition=fade:duration=${CROSSFADE}:offset=${(edges[i] - half).toFixed(3)}[x${i}];`;
    last = `[x${i}]`;
  }
  const commands = pulseCommands(envelope, path.join(dir, 'pulse.cmd'));
  graph += `${last}sendcmd=f='${commands}',crop@pulse=w=1920:h=1080,eq@pulse=brightness=0:saturation=1,scale=${SIZE},setsar=1[v]`;
  await ffmpeg([...parts.flatMap(p => ['-i', p.file]), '-filter_complex', graph, '-map', '[v]', '-t', seconds.toFixed(3), ...WORK, file]);
  return { file, bars: parts.map(p => p.bars) };
}

/**
 * Grain for a picture this bright: 1 for a bright one, 3 for a dark one.
 * Grain is noise, and noise is what an encoder spends bits on; mvplanner
 * found bright shots need almost none.
 */
async function grainFor(file, seconds) {
  const samples = (await Promise.all([0.15, 0.4, 0.65, 0.9].map(f => lumaAt(file, f * seconds)))).filter(v => v !== null);
  if (!samples.length) return 2;
  const brightness = Math.min(1, Math.max(0, (samples.reduce((s, v) => s + v, 0) / samples.length - 16) / 219));
  return Math.round(1 + 2 * (1 - brightness));
}

/**
 * The finished video at `size`, `seconds` long. With `from` (a Short), the
 * base and the recording start that far into the piece and the sound fades in
 * and out (from `fadeAt`, where the voice stops); the layers are already the
 * passage's own. `title`, a card, fades in over the opening and out; each of
 * `overlays` ({ file, start, end }, a frame-sized image) fades in and out over
 * its own time.
 */
async function compose({ base, milkdrop, mandala, audio, title = null, brief, seconds, out, size = LANDSCAPE, from = null, overlays = [], fadeAt = Math.max(0, seconds - 1.5) }) {
  const grain = await grainFor(base, (from || 0) + seconds);
  const fadeOut = Math.max(0, seconds - 2.5).toFixed(3);
  const dims = `${size.width}:${size.height}`;
  // The base footage is landscape: a frame of another shape is cut from its
  // middle (for the full video's own size, the whole frame).
  const cover = `crop=w='min(iw,ih*${size.width}/${size.height})':h='min(ih,iw*${size.height}/${size.width})'`;
  const at = from ? ['-ss', from.toFixed(3)] : [];
  const graph = [
    `[0:v]${cover},scale=${dims}:flags=bicubic,fps=${FPS},format=gbrp[base]`,
    `[1:v]scale=${dims}:flags=bicubic,fps=${FPS},format=gbrp[milk]`,
    `[2:v]scale=${dims}:flags=bicubic,fps=${FPS},format=gbrp[mandala]`,
    `[base][milk]blend=all_mode=screen:all_opacity=${brief.milkdropOpacity}[l1]`,
    `[l1][mandala]blend=all_mode=screen:all_opacity=${brief.mandalaOpacity}[l2]`,
    // The finish: bloom, chromatic split, hue drift, grain, vignette. The
    // bloom is soft by nature, so it is blurred at a quarter of the size and
    // scaled back: the effects ran 23% faster, with the same SSIM against a
    // full-size bloom (0.957), measured on 2026-10-27.
    `[l2]split[f1][f2];[f2]scale=${size.width / 4}:${size.height / 4},gblur=sigma=7,scale=${dims}:flags=bicubic[glow];[f1][glow]blend=all_mode=screen:all_opacity=0.35,format=yuv420p,` +
      `rgbashift=rh=3:bh=-3,hue=h='12*sin(2*PI*t/40)':s=1.08,noise=alls=${grain}:allf=t,vignette=PI/4.5,` +
      `fade=out:st=${fadeOut}:d=2.5[pic]`,
  ];
  const inputs = [...at, '-i', base, '-i', milkdrop, '-i', mandala, ...at, '-i', audio];
  // The title card in over the opening and out by eight seconds, as it always
  // was; the overlays each over their own time.
  const cards = [...(title ? [{ file: title, start: 0.8, end: 8, fade: 1.5, fadeOut: 2 }] : []), ...overlays];
  let last = '[pic]';
  cards.forEach((card, k) => {
    const fade = card.fade || 0.15, fadeOut = card.fadeOut || fade;
    inputs.push('-loop', '1', '-t', seconds.toFixed(3), '-i', card.file);
    graph.push(`[${4 + k}:v]format=rgba,fade=in:st=${card.start.toFixed(3)}:d=${fade}:alpha=1,fade=out:st=${Math.max(card.start, card.end - fadeOut).toFixed(3)}:d=${fadeOut}:alpha=1[c${k}]`,
      `${last}[c${k}]overlay=0:0:enable='between(t,${card.start.toFixed(3)},${card.end.toFixed(3)})'[o${k}]`);
    last = `[o${k}]`;
  });
  graph.push(`${last}format=yuv420p[v]`);
  let sound = '3:a';
  if (from) {
    graph.push(`[3:a]afade=t=in:d=0.3,afade=t=out:st=${fadeAt.toFixed(3)}:d=${(seconds - fadeAt).toFixed(3)}[a]`);
    sound = '[a]';
  }
  await ffmpeg([...inputs,
    '-filter_complex', graph.join(';'), '-map', '[v]', '-map', sound, '-t', seconds.toFixed(3),
    // YouTube's recommended upload rate for 1080p at 30 fps, 8 Mbps, and a
    // keyframe every two seconds. news-community's 3.5 Mbps cap blocked and
    // smeared this content's fine detail. Written under a temporary name and
    // renamed when whole, so nothing reads a half-written video.
    '-c:v', 'libx264', '-preset', 'medium', '-profile:v', 'high', '-crf', '23', '-maxrate', '8000k', '-bufsize', '16000k',
    '-force_key_frames', 'expr:gte(t,n_forced*2)', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-f', 'mp4', `${out}.part`]);
  fs.renameSync(`${out}.part`, out);
  return { file: out, grain };
}

module.exports = { compose, baseFootage, titleCard, FPS, LANDSCAPE, PORTRAIT };
