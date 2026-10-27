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
 *   title    the piece's name, faded in over the opening and out again
 *
 * with the recording, at its house level, as the sound. Variants leave layers
 * out, so the pilot can compare them.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Resvg } = require('@resvg/resvg-js');

const FPS = 30;
const SIZE = '1920:1080';
const CROSSFADE = 3;
const FONT_DIR = path.join(__dirname, '../../server/assets/fonts');
const FONTS = { fontFiles: ['InterDisplay-Light.ttf', 'Inter-Regular.ttf'].map(f => path.join(FONT_DIR, f)), loadSystemFonts: false, defaultFontFamily: 'Inter' };

function ffmpeg(args, label) {
  const out = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'pipe'] });
  if (out.status !== 0) throw new Error(`ffmpeg failed (${label}): ${String(out.stderr).slice(-1500)}`);
}

const escapeXml = (s) => s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);

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
  <text x="960" y="${top + (lines.length - 1) * lineHeight + 96}" text-anchor="middle" font-family="Inter" font-weight="400" font-size="26" letter-spacing="10" fill="#ffffff" fill-opacity="0.75">ACHURCH.AI</text>
</svg>`;
  fs.writeFileSync(file, new Resvg(svg, { font: FONTS }).render().asPng());
  return file;
}

const probeSeconds = (file) => Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout);

// A clip that does not end where it began is played forward then backward.
function loopSource(clip) {
  if (clip.seamless) return clip.file;
  const source = clip.file.replace(/\.mp4$/, '.pingpong.mp4');
  if (!fs.existsSync(source)) {
    ffmpeg(['-i', clip.file, '-filter_complex', `[0:v]scale=${SIZE},fps=${FPS},split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1[v]`, '-map', '[v]', '-an', '-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuv420p', source], 'pingpong');
  }
  return source;
}

/**
 * One movement's footage, from `start` for `seconds` of the piece, its loop
 * repeated. With a beat grid the loop is stretched to a whole number of bars
 * and its every cycle begins on a downbeat; without one, its first cycle
 * begins where the movement does.
 */
function movementFootage(clip, { start, seconds, grid }, file) {
  const source = loopSource(clip);
  const length = probeSeconds(source);
  const bars = grid ? Math.max(1, Math.round(length / grid.bar)) : 0;
  const cycle = grid ? bars * grid.bar : length;
  const anchor = grid ? grid.downbeat : start;
  const into = (((start - anchor) % cycle) + cycle) % cycle;
  ffmpeg(['-stream_loop', '-1', '-i', source, '-vf',
    `setpts=(PTS-STARTPTS)*${(cycle / length).toFixed(6)},fps=${FPS},trim=start=${into.toFixed(3)}:duration=${seconds.toFixed(3)},setpts=PTS-STARTPTS,scale=${SIZE},setsar=1`,
    '-an', '-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuv420p', file], 'movement');
  return { file, bars, cycle };
}

/**
 * The loops' answer to the sound, as ffmpeg commands for each frame: a slight
 * push in and brightening as the recording swells, and for a song a kick on
 * each beat. Written for sendcmd, which drives the crop and eq filters.
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
 * centred on each edge, then moved by the sound when an envelope is given.
 */
function baseFootage(clips, { edges, grid, envelope, dir }) {
  const file = path.join(dir, 'base.mp4');
  const n = clips.length;
  const seconds = edges[n];
  const half = CROSSFADE / 2;
  const parts = clips.map((clip, i) => {
    const from = i ? edges[i] - half : 0;
    const to = i < n - 1 ? edges[i + 1] + half : seconds;
    return movementFootage(clip, { start: from, seconds: to - from + 0.2, grid }, path.join(dir, `movement-${i + 1}.mp4`));
  });
  const inputs = parts.flatMap(p => ['-i', p.file]);
  let graph = '', last = '[0:v]';
  for (let i = 1; i < n; i++) {
    const out = `[x${i}]`;
    graph += `${last}[${i}:v]xfade=transition=fade:duration=${CROSSFADE}:offset=${(edges[i] - half).toFixed(3)}${out};`;
    last = out;
  }
  if (envelope) {
    const commands = pulseCommands(envelope, path.join(dir, 'pulse.cmd'));
    graph += `${last}sendcmd=f='${commands}',crop@pulse=w=1920:h=1080,eq@pulse=brightness=0:saturation=1,scale=${SIZE},setsar=1[v]`;
  } else graph += `${last}null[v]`;
  ffmpeg([...inputs, '-filter_complex', graph, '-map', '[v]', '-t', seconds.toFixed(3), '-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuv420p', file], 'base');
  return { file, bars: parts.map(p => p.bars) };
}

/**
 * @param {'loops'|'milkdrop'|'full'} variant
 */
function compose({ variant, base, milkdrop, mandala, audio, title, brief, seconds, out }) {
  const fadeOut = Math.max(0, seconds - 2.5).toFixed(3);
  const inputs = [];
  const add = (args) => { inputs.push(...args); return inputs.filter(a => a === '-i').length - 1; };
  const parts = [];
  let layer;
  if (variant !== 'milkdrop') {
    const b = add(['-i', base]);
    parts.push(`[${b}:v]scale=${SIZE},fps=${FPS},format=gbrp[base]`);
    layer = '[base]';
  }
  if (variant !== 'loops') {
    const m = add(['-i', milkdrop]);
    parts.push(`[${m}:v]scale=${SIZE}:flags=bicubic,fps=${FPS},format=gbrp[milk]`);
    if (layer) {
      parts.push(`${layer}[milk]blend=all_mode=screen:all_opacity=${brief.milkdropOpacity ?? 0.55}[l1]`);
      layer = '[l1]';
    } else layer = '[milk]';
  }
  if (variant === 'full') {
    const d = add(['-i', mandala]);
    parts.push(`[${d}:v]scale=${SIZE}:flags=bicubic,fps=${FPS},format=gbrp[mandala]`);
    parts.push(`${layer}[mandala]blend=all_mode=screen:all_opacity=${brief.mandalaOpacity ?? 0.45}[l2]`);
    layer = '[l2]';
  }
  // The finish: bloom, chromatic split, hue drift, grain, vignette.
  parts.push(`${layer}split[f1][f2];[f2]gblur=sigma=28[glow];[f1][glow]blend=all_mode=screen:all_opacity=0.35,format=yuv420p,` +
    `rgbashift=rh=3:bh=-3,hue=h='12*sin(2*PI*t/40)':s=1.08,noise=alls=4:allf=t,vignette=PI/4.5,` +
    `fade=in:st=0:d=1.5,fade=out:st=${fadeOut}:d=2.5[pic]`);
  const t = add(['-loop', '1', '-t', '9', '-i', title]);
  parts.push(`[${t}:v]format=rgba,fade=in:st=0.8:d=1.5:alpha=1,fade=out:st=6:d=2:alpha=1[title]`);
  parts.push(`[pic][title]overlay=0:0:eof_action=pass,format=yuv420p[v]`);
  const a = add(['-i', audio]);
  ffmpeg([...inputs, '-filter_complex', parts.join(';'), '-map', '[v]', '-map', `${a}:a`, '-t', seconds.toFixed(3),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', out], variant);
  return out;
}

module.exports = { compose, baseFootage, titleCard, FPS };
