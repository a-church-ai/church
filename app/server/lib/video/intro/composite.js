/**
 * The intro on screen: the speaker composited into the Short's own moving
 * light, never repainted into it. The look was chosen by the owner on
 * 2026-11-10 from a hand-made test (short-intros-2026-11-10.md, private repo):
 *
 * 1. The base: the Short's footage from the seconds before its passage, upright.
 * 2. The speaker, cut out (matte.js), at 85% beside the light, the head
 *    about 40% down, on the side away from it (rules.js sideFor):
 *    - graded toward the piece's palette, shadows lifted into its dark;
 *    - fading into the light from the chest down;
 *    - a halo of the piece's warm light on the side facing the light only;
 *    - leaving by the intro's exit: rising into the light, drifting into
 *      it, or fading.
 * 3. Over them, the house's MilkDrop and mandala, moved by the intro's own
 *    voice, softer than the passage's (0.3) so the face stays clear.
 * 4. The intro's grade on the speaker alone: for old-film, the speaker's
 *    outline in the finished picture turned to old-film black and white, so
 *    the light over them keeps its colour around them (the owner, 2026-11-12;
 *    short-intros-film-look-ab-2026-11-12.md, private repo).
 * 5. The captions, from the voice's own times, and the piece's name.
 *
 * Then joined to the Short, the intro's last quiet crossing into it.
 */

const fs = require('fs');
const path = require('path');
const { ffmpeg } = require('../../audio/assemble');
const { analyse } = require('../analysis');
const { renderLayers } = require('../visual');
const { FPS, PORTRAIT } = require('../compose');
const { captionOverlays, labelPng, SAFE } = require('../captions');
const { SITE_NAME } = require('../../utils/page-meta');

const { width: W, height: H } = PORTRAIT;
const SCALE = 0.85;
const SW = Math.round(W * SCALE / 2) * 2, SH = Math.round(H * SCALE / 2) * 2;
// Lower, below the name and inside the Shorts box: the head about 40% down.
const Y0 = Math.round(0.26 * H);
// From the middle toward one side, a fifth of the width.
const SHIFT = Math.round(0.2 * W);
// Where the body thins into the light, as fractions of the frame's height.
const FADE_TOP = 0.66, FADE_BOTTOM = 0.92;
// The light over the speaker, softer than the passage's.
const LIGHT = 0.3;
// The intro's last quiet crossing into the Short.
const JOIN = 0.6;
// The speaker's grade (rules.js GRADE): the filter over their outline, or
// null to leave them as made. Old film: grey, harder, a flicker of light a
// frame, grain with dust, a little soft.
const GRADES = {
  colour: null,
  'old-film': "hue=s=0,eq=contrast=1.2:brightness='(random(1)-0.5)*0.06':eval=frame,noise=alls=22:allf=t+u,gblur=sigma=0.7"
};

const hex = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const n = (v) => +v.toFixed(4);

/**
 * The filter graph that composites the speaker (inputs 1, the colours, and
 * 2, the matte, both at 25 or 30 fps) over the base (input 0, already from
 * its start), `seconds` long, leaving from `exit` to `seen`. A grade with a
 * filter also gives [mask], the speaker's outline where they stand in the
 * frame, placed by the same x as the speaker. Pure.
 */
function personGraph({ seconds, exit, seen, kind, side, palette, grade = 'colour' }) {
  const x0 = Math.round((W - SW) / 2 + (side === 'left' ? -SHIFT : SHIFT));
  const dir = side === 'left' ? -1 : 1;
  const span = n(Math.max(0.3, seen - exit));
  // c: how far through leaving, 0 to 1; p: the same, eased.
  const c = `clip((T-${n(exit)})/${span},0,1)`;
  const p = `(${c}*${c}*(3-2*${c}))`;
  const rise = kind === 'rise' ? p : '0';
  const top = `(${FADE_TOP}-1.2*${rise})`, bottom = `(${FADE_BOTTOM}-1.2*${rise})`;
  // The frame's height fraction at a row of the speaker's own picture.
  const yc = `((${Y0}+(Y+0.5)/H*${SH})/${H})`;
  const r = `clip((${bottom}-${yc})/(${bottom}-${top}),0,1)`;
  const ramp = `255*${r}*${r}*(3-2*${r})`;
  // The rising line's glow, where it passes through them.
  const band = kind === 'rise' ? `255*exp(-pow((${yc}-${bottom})/0.022,2))*clip(${c}*4,0,1)*(1-${c})` : '0';
  // The halo only on the side facing the light.
  const xc = `((${x0}+(X+0.5)/W*${SW})/${W})`;
  const s = `clip(((${side === 'left' ? xc : `1-${xc}`})-0.2)/0.3,0,1)`;
  const sideMask = `255*${s}*${s}*(3-2*${s})`;
  const [ir, ig, ib] = hex(palette[1]).map(v => n(v / 255 * 0.28));
  const amber = palette[3].replace('#', '0x');
  const d = n(seconds);
  const leave = kind === 'rise' ? '' : `,fade=out:st=${n(exit)}:d=${span}`;
  // In overlay's expressions time is t (geq's is T).
  const x = kind === 'drift' ? `'${x0}+${dir * Math.round(0.15 * W)}*${p.replace(/T/g, 't')}'` : String(x0);
  const graded = !!GRADES[grade];
  return [
    `[0:v]crop=w='ih*9/16':h=ih,scale=${W}:${H}:flags=bicubic,fps=${FPS},format=rgb24,trim=duration=${d}[bg]`,
    `[1:v]fps=${FPS},scale=${SW}:${SH}:flags=bicubic,tpad=stop_mode=clone:stop_duration=${d},trim=duration=${d},format=rgb24,` +
      `curves=r='0/${ir} 1/1':g='0/${ig} 1/1':b='0/${ib} 1/1',colorbalance=rh=0.03:bh=-0.03,eq=saturation=0.92[fg]`,
    `[2:v]fps=${FPS},scale=${SW}:${SH}:flags=bicubic,tpad=stop_mode=clone:stop_duration=${d},trim=duration=${d},format=gray[a0]`,
    `nullsrc=s=8x64:r=${FPS}:d=${d},geq=lum='${ramp}',scale=${SW}:${SH}:flags=bilinear,format=gray[ramp]`,
    `[a0]split=2[aRamp][aBand]`,
    // No fade in: the speaker is there from the first frame, which some
    // platforms show as the Short's cover (the owner, 2026-11-10).
    `[aRamp][ramp]blend=all_mode=multiply${leave},split=${graded ? '4' : '3'}[a][aHalo][aIn]${graded ? '[aMask]' : ''}`,
    `[fg][a]alphamerge[person]`,
    `nullsrc=s=64x8:r=${FPS}:d=${d},geq=lum='${sideMask}',scale=${SW}:${SH}:flags=bilinear,format=gray[side]`,
    `[aHalo]gblur=sigma=22[blur]`,
    `[blur][aIn]blend=all_expr='A*(255-B)/255'[outer]`,
    `[outer][side]blend=all_mode=multiply,lut=y='val*0.85'[halo]`,
    `color=c=${amber}:s=${SW}x${SH}:r=${FPS}:d=${d},format=rgb24[amber]`,
    `[amber][halo]alphamerge[glow]`,
    `nullsrc=s=8x64:r=${FPS}:d=${d},geq=lum='${band}',scale=${SW}:${SH}:flags=bilinear,format=gray[bandRamp]`,
    `[aBand][bandRamp]blend=all_mode=multiply,gblur=sigma=6,lut=y='val*0.55'[bandMask]`,
    `color=c=0xfff0d8:s=${SW}x${SH}:r=${FPS}:d=${d},format=rgb24[warm]`,
    `[warm][bandMask]alphamerge[line]`,
    `[bg][glow]overlay=x=${x}:y=${Y0}:eval=frame[c1]`,
    `[c1][person]overlay=x=${x}:y=${Y0}:eval=frame[c2]`,
    `[c2][line]overlay=x=${x}:y=${Y0}:eval=frame,format=yuv444p[out]`,
    ...(graded ? [`color=c=black:s=${W}x${H}:r=${FPS}:d=${d},format=gray[black]`, `[black][aMask]overlay=x=${x}:y=${Y0}:eval=frame,format=gray[mask]`] : [])
  ].join(';');
}

// The speaker over the base, without the light: <dir>/intro.person.mp4, and
// for a grade with a filter their outline, <dir>/intro.mask.mkv (else null).
async function renderPerson({ base, from, fg, alpha, times, intro, side, palette, dir }) {
  const out = path.join(dir, 'intro.person.mp4');
  const mask = GRADES[intro.grade] ? path.join(dir, 'intro.mask.mkv') : null;
  const graph = personGraph({ seconds: times.total, exit: times.exit, seen: times.seen, kind: intro.exit, side, palette, grade: intro.grade });
  const t = times.total.toFixed(3);
  await ffmpeg(['-ss', from.toFixed(3), '-i', base, '-i', fg, '-i', alpha, '-filter_complex', graph,
    '-map', '[out]', '-t', t, '-c:v', 'libx264', '-crf', '12', '-preset', 'medium', '-pix_fmt', 'yuv444p', '-y', out,
    ...(mask ? ['-map', '[mask]', '-t', t, '-c:v', 'ffv1', '-y', mask] : [])]);
  return { person: out, mask };
}

/**
 * The finished intro: the house's light over the composited speaker, moved
 * by the intro's own voice; the finish every video has; the captions and the
 * piece's name; the voice at the house's level. <dir>/intro.mp4.
 */
async function renderIntro({ person, mask, grade, voice, words, times, brief, title, dir, log = console.log }) {
  const analysis = await analyse(voice, FPS);
  // The light of the piece's first movement, for the intro's length.
  const { milkdropFile, mandalaFile } = await renderLayers({ analysis, brief: { ...brief, movements: [brief.movements[0]] }, edges: [0, analysis.seconds], fps: FPS, dir, log, size: { width: 720, height: 1280 }, prefix: 'intro.' });
  const captions = captionOverlays(words, { from: 0, to: times.total, size: PORTRAIT, dir }).map((c, k) => ({ ...c, file: c.file }));
  const name = labelPng([{ text: title, size: 54, family: 'Inter Display', weight: 300 }, { text: SITE_NAME, size: 28, family: 'Inter', weight: 400, opacity: 0.8 }], { y: SAFE.top + 0.03, size: PORTRAIT, file: path.join(dir, 'intro.title.png') });
  const cards = [...captions, { ...name, start: 0.3, end: times.total, fade: 0.6, fadeOut: 0.01 }];
  const dims = `${W}:${H}`;
  const graph = [
    `[0:v]scale=${dims},fps=${FPS},format=gbrp[base]`,
    `[1:v]scale=${dims}:flags=bicubic,fps=${FPS},format=gbrp[milk]`,
    `[2:v]scale=${dims}:flags=bicubic,fps=${FPS},format=gbrp[mandala]`,
    `[base][milk]blend=all_mode=screen:all_opacity=${LIGHT}[l1]`,
    `[l1][mandala]blend=all_mode=screen:all_opacity=${LIGHT}[l2]`,
    `[l2]split[f1][f2];[f2]scale=${W / 4}:${H / 4},gblur=sigma=7,scale=${dims}:flags=bicubic[glow];[f1][glow]blend=all_mode=screen:all_opacity=0.35,format=yuv420p,rgbashift=rh=3:bh=-3,noise=alls=6:allf=t,vignette=PI/4.5[pic]`
  ];
  const inputs = ['-i', person, '-i', milkdropFile, '-i', mandalaFile, '-i', voice];
  let last = '[pic]';
  // The grade on the speaker alone, after the light, so it does not tint them back.
  if (GRADES[grade]) {
    inputs.push('-i', mask);
    graph.push(`[pic]format=gbrp,split[asMade][toGrade]`, `[toGrade]${GRADES[grade]},format=gbrp[graded]`,
      `[${inputs.length / 2 - 1}:v]fps=${FPS},format=gray,format=gbrp[outline]`, `[asMade][graded][outline]maskedmerge,format=yuv420p[gradedPic]`);
    last = '[gradedPic]';
  }
  const cardsFrom = inputs.length / 2;
  cards.forEach((card, k) => {
    const fade = card.fade || 0.15, fadeOut = card.fadeOut || fade;
    inputs.push('-loop', '1', '-t', times.total.toFixed(3), '-i', card.file);
    graph.push(`[${cardsFrom + k}:v]format=rgba,fade=in:st=${card.start.toFixed(3)}:d=${fade}:alpha=1,fade=out:st=${Math.max(card.start, card.end - fadeOut).toFixed(3)}:d=${fadeOut}:alpha=1[c${k}]`,
      `${last}[c${k}]overlay=0:0:enable='between(t,${card.start.toFixed(3)},${card.end.toFixed(3)})'[o${k}]`);
    last = `[o${k}]`;
  });
  // The voice at the house's speech level (audio/house-sound.json speech.level).
  graph.push(`${last}format=yuv420p[v]`, `[3:a]aresample=48000,aformat=channel_layouts=stereo,loudnorm=I=-18:TP=-1.5:LRA=11,aresample=48000[a]`);
  const out = path.join(dir, 'intro.mp4');
  await ffmpeg([...inputs, '-filter_complex', graph.join(';'), '-map', '[v]', '-map', '[a]', '-t', times.total.toFixed(3), '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-y', out]);
  return { file: out, captions: captions.length };
}

// The intro joined to the Short, picture and sound crossing over its last quiet.
async function joinToShort({ intro, short, seconds, out }) {
  const at = (seconds - JOIN).toFixed(3);
  await ffmpeg(['-i', intro, '-i', short, '-filter_complex',
    `[0:v]fps=${FPS},format=yuv420p,settb=AVTB[a0];[1:v]fps=${FPS},format=yuv420p,settb=AVTB[b0];[a0][b0]xfade=transition=fade:duration=${JOIN}:offset=${at}[v];` +
    `[0:a]aresample=48000,aformat=channel_layouts=stereo[aa];[1:a]aresample=48000,aformat=channel_layouts=stereo[ba];[aa][ba]acrossfade=d=${JOIN}[a]`,
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'medium', '-profile:v', 'high', '-crf', '23', '-maxrate', '8000k', '-bufsize', '16000k',
    '-force_key_frames', 'expr:gte(t,n_forced*2)', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-y', `${out}.part.mp4`]);
  fs.renameSync(`${out}.part.mp4`, out);
  return out;
}

module.exports = { personGraph, renderPerson, renderIntro, joinToShort, JOIN, LIGHT, GRADES, W, H };
