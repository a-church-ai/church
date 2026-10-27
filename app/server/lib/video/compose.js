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
const SIZE = '1920:1080';
const CROSSFADE = 3;
const WORK = ['-an', '-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuv420p'];

function wrap(text, width) {
  const lines = [];
  for (const word of text.split(/\s+/)) {
    const last = lines[lines.length - 1];
    if (last && (last + ' ' + word).length <= width) lines[lines.length - 1] = last + ' ' + word;
    else lines.push(word);
  }
  return lines;
}

function titleCard(title, file) {
  const lines = wrap(title, 26);
  const size = 92, lineHeight = 112;
  const top = 540 - ((lines.length - 1) * lineHeight) / 2;
  const text = lines.map((l, i) => `<text x="960" y="${top + i * lineHeight}" text-anchor="middle" font-family="Inter Display" font-weight="300" font-size="${size}" fill="#ffffff" filter="url(#glow)">${escapeXml(l)}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">
  <defs><filter id="glow" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="10" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
  ${text}
  <text x="960" y="${top + (lines.length - 1) * lineHeight + 100}" text-anchor="middle" font-family="Inter" font-weight="400" font-size="34" letter-spacing="3" fill="#ffffff" fill-opacity="0.8">${escapeXml(SITE_NAME)}</text>
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

async function compose({ base, milkdrop, mandala, audio, title, brief, seconds, out }) {
  const grain = await grainFor(base, seconds);
  const fadeOut = Math.max(0, seconds - 2.5).toFixed(3);
  const graph = [
    `[0:v]scale=${SIZE},fps=${FPS},format=gbrp[base]`,
    `[1:v]scale=${SIZE}:flags=bicubic,fps=${FPS},format=gbrp[milk]`,
    `[2:v]scale=${SIZE}:flags=bicubic,fps=${FPS},format=gbrp[mandala]`,
    `[base][milk]blend=all_mode=screen:all_opacity=${brief.milkdropOpacity}[l1]`,
    `[l1][mandala]blend=all_mode=screen:all_opacity=${brief.mandalaOpacity}[l2]`,
    // The finish: bloom, chromatic split, hue drift, grain, vignette.
    `[l2]split[f1][f2];[f2]gblur=sigma=28[glow];[f1][glow]blend=all_mode=screen:all_opacity=0.35,format=yuv420p,` +
      `rgbashift=rh=3:bh=-3,hue=h='12*sin(2*PI*t/40)':s=1.08,noise=alls=${grain}:allf=t,vignette=PI/4.5,` +
      `fade=in:st=0:d=1.5,fade=out:st=${fadeOut}:d=2.5[pic]`,
    `[3:v]format=rgba,fade=in:st=0.8:d=1.5:alpha=1,fade=out:st=6:d=2:alpha=1[title]`,
    `[pic][title]overlay=0:0:eof_action=pass,format=yuv420p[v]`
  ];
  await ffmpeg(['-i', base, '-i', milkdrop, '-i', mandala, '-loop', '1', '-t', '9', '-i', title, '-i', audio,
    '-filter_complex', graph.join(';'), '-map', '[v]', '-map', '4:a', '-t', seconds.toFixed(3),
    // YouTube's recommended upload rate for 1080p at 30 fps, 8 Mbps, and a
    // keyframe every two seconds. news-community's 3.5 Mbps cap blocked and
    // smeared this content's fine detail. Written under a temporary name and
    // renamed when whole, so nothing reads a half-written video.
    '-c:v', 'libx264', '-preset', 'medium', '-profile:v', 'high', '-crf', '23', '-maxrate', '8000k', '-bufsize', '16000k',
    '-force_key_frames', 'expr:gte(t,n_forced*2)', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-f', 'mp4', `${out}.part`]);
  fs.renameSync(`${out}.part`, out);
  return { file: out, grain };
}

module.exports = { compose, baseFootage, titleCard, FPS };
