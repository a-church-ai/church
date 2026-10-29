/**
 * The two audio-driven layers, rendered offline in headless Chrome (butterchurn
 * needs WebGL 2, which Node's headless-gl lacks):
 *
 * - milkdrop: butterchurn playing the brief's presets, one per movement,
 *   blended into each other where the movements change, fed the recording's own waveform frame by frame
 *   with a fixed time step, so a render does not depend on how fast it runs.
 * - mandala: the house's own layer, a k-fold ring of the spectrum drawn in the
 *   brief's palette with glow and trails, breathing with the voice.
 *
 * Each is drawn on black, to be screen-blended over the loops, and written as
 * its own video. Frames go to ffmpeg as JPEGs, a batch per round trip.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');
const { lookOf, DEFAULT_STYLE } = require('./looks');

// The layers' size for a full video; a Short's are drawn upright at 720x1280.
const LANDSCAPE = { width: 1280, height: 720 };
const BATCH = 15;
const PRESET_PACKS = ['butterchurnPresets', 'butterchurnPresetsExtra', 'butterchurnPresetsExtra2', 'butterchurnPresetsMD1'];
// Eight geometric presets from projectM's Cream of the Crop pack (spheres,
// hexagons, a lotus, circles, all drawn on black), as satchitananda's video
// pipeline converted them to butterchurn's JSON, without their custom
// shaders. The pack drops any preset its author asks it to; so would we.
const CREAM = require('./presets-cream.json');
const PACKS = [...PRESET_PACKS, 'creamPresets'];
const MODULES = path.join(__dirname, '../../../node_modules');

// A headless Chrome page with butterchurn and every preset pack loaded.
async function butterchurnPage(width, height) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent('<html><body style="margin:0;background:#000"></body></html>');
  await page.addScriptTag({ path: path.join(MODULES, 'butterchurn/lib/butterchurn.min.js') });
  for (const pack of PRESET_PACKS) await page.addScriptTag({ path: path.join(MODULES, `butterchurn-presets/lib/${pack}.min.js`) });
  await page.evaluate((presets) => { window.creamPresets = { getPresets: () => presets }; }, CREAM);
  return { browser, page };
}

function encoder(file, fps) {
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(fps), '-i', '-',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((resolve, reject) => ff.on('close', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code} for ${file}`)))));
  return {
    write: (buf) => (ff.stdin.write(buf) ? null : new Promise(r => ff.stdin.once('drain', r))),
    end: () => { ff.stdin.end(); return done; }
  };
}

// Runs in the page.
function pageSetup({ W, H, fps, packs, presets, palette, symmetry, style, edges, from }) {
  const bc = window.butterchurn.default || window.butterchurn;
  const all = {};
  for (const pack of packs) {
    const mod = window[pack];
    Object.assign(all, (mod.getPresets || mod.default.getPresets)());
  }
  const audio = new AudioContext({ sampleRate: 44100 });
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  document.body.appendChild(canvas);
  const viz = bc.createVisualizer(audio, canvas, { width: W, height: H, pixelRatio: 1, textureRatio: 1 });
  // A window that starts mid-piece opens on its own movement's preset.
  const movementAt = (t) => Math.min(presets.length - 1, edges.slice(1, -1).filter(e => t >= e).length);
  let current = movementAt(from / fps);
  viz.loadPreset(all[presets[current]], 0);

  const fx = document.createElement('canvas');
  fx.width = W; fx.height = H;
  const g = fx.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);

  // The mandala is sized by the shorter side, so it fits an upright frame.
  const S = Math.min(W, H);
  window.renderFrame = (f, wave, spectrum) => {
    const t = f / fps;
    const movement = movementAt(t);
    if (movement !== current) { current = movement; viz.loadPreset(all[presets[movement]], 5.0); }
    viz.render({ audioLevels: { timeByteArray: Uint8Array.from(wave.mono), timeByteArrayL: Uint8Array.from(wave.left), timeByteArrayR: Uint8Array.from(wave.right) }, elapsedTime: 1 / fps });

    // Mandala: fade the last frame for trails, then draw this one additively.
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = `rgba(0,0,0,${style.fade})`;
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    const { bands, loud } = spectrum;
    const cx = W / 2, cy = H / 2, k = symmetry;
    const rings = 4;
    for (let r = 0; r < rings; r++) {
      const base = (0.1 + 0.1 * r) * S * (1 + 0.18 * style.pulse * loud);
      const amp = (0.09 + 0.05 * r) * S * style.pulse;
      const spin = (r % 2 ? -1 : 1) * (0.05 + 0.03 * r) * style.spin * t;
      g.beginPath();
      const steps = 360;
      for (let s = 0; s <= steps; s++) {
        const theta = (s / steps) * Math.PI * 2;
        const sector = ((theta * k) / (Math.PI * 2)) % 1;
        const mirrored = sector < 0.5 ? sector * 2 : (1 - sector) * 2;
        const span = Math.floor(bands.length / rings);
        const pos = r * span + mirrored * (span - 1);
        const lo = Math.min(bands.length - 1, Math.floor(pos)), hi = Math.min(bands.length - 1, lo + 1);
        const ease = 0.5 - 0.5 * Math.cos((pos - lo) * Math.PI);
        const rad = base + (bands[lo] * (1 - ease) + bands[hi] * ease) * amp;
        const x = cx + rad * Math.cos(theta + spin), y = cy + rad * Math.sin(theta + spin);
        s ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.strokeStyle = palette[(r + 1) % palette.length];
      g.lineWidth = (2.5 + loud * 3) * style.line;
      g.shadowColor = palette[(r + 2) % palette.length];
      g.shadowBlur = (22 + 26 * loud) * style.glow;
      g.globalAlpha = 0.7 + 0.3 * Math.min(1, loud);
      g.stroke();
    }
    // Spokes on the low end: k petals reaching out with the bass.
    const bass = (bands[0] + bands[1] + bands[2] + bands[3]) / 4;
    for (let i = 0; i < k; i++) {
      const a = (i / k) * Math.PI * 2 + 0.03 * style.spin * t;
      const len = (0.08 + 0.32 * bass) * S * style.spokes;
      g.beginPath();
      g.moveTo(cx, cy);
      g.quadraticCurveTo(cx + len * 0.6 * Math.cos(a + 0.4), cy + len * 0.6 * Math.sin(a + 0.4), cx + len * Math.cos(a), cy + len * Math.sin(a));
      g.strokeStyle = palette[4];
      g.globalAlpha = (0.25 + 0.5 * bass) * Math.min(1, style.spokes);
      g.lineWidth = 1;
      g.shadowBlur = 24 * style.glow;
      g.stroke();
    }
    // Sacred geometry, for the kinds that have it: a flower-of-life of k
    // circles round a centre one, and a k-pointed star between two k-gons,
    // turning against each other and breathing with the voice.
    if (style.geometry > 0) {
      g.strokeStyle = palette[3];
      g.shadowColor = palette[4];
      g.shadowBlur = 18 * style.glow;
      g.lineWidth = 1.2 * style.line;
      g.globalAlpha = style.geometry * (0.22 + 0.35 * Math.min(1, loud));
      const R = 0.15 * S * (1 + 0.08 * loud);
      const turn = 0.02 * style.spin * t;
      g.beginPath();
      g.arc(cx, cy, R, 0, Math.PI * 2);
      for (let i = 0; i < k; i++) {
        const a = (i / k) * Math.PI * 2 + turn;
        g.moveTo(cx + R * Math.cos(a) + R, cy + R * Math.sin(a));
        g.arc(cx + R * Math.cos(a), cy + R * Math.sin(a), R, 0, Math.PI * 2);
      }
      g.stroke();
      const polygon = (radius, step, offset) => {
        g.beginPath();
        for (let i = 0; i <= k; i++) {
          const a = ((i * step) / k) * Math.PI * 2 + offset;
          const x = cx + radius * Math.cos(a), y = cy + radius * Math.sin(a);
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.stroke();
      };
      polygon(0.34 * S, 1, -turn);
      polygon(0.46 * S, 1, turn);
      if (k >= 5) polygon(0.46 * S, Math.floor((k - 1) / 2), turn);
    }
    g.globalAlpha = 1;
    g.shadowBlur = 0;
    return [canvas.toDataURL('image/jpeg', 0.92), fx.toDataURL('image/jpeg', 0.92)];
  };
}

/**
 * The two layers, at `size`, over the frames [from, to) of the piece: the
 * whole piece for a full video, a passage for a Short (short.js), whose
 * files carry its `prefix`.
 */
async function renderLayers({ analysis, brief, edges, fps, dir, log = console.log, size = LANDSCAPE, from = 0, to = analysis.frames, prefix = '' }) {
  const milkdropFile = path.join(dir, `${prefix}milkdrop.mp4`);
  const mandalaFile = path.join(dir, `${prefix}mandala.mp4`);
  // Kept while what shapes them is unchanged: the presets, palette, symmetry,
  // the kind (whose look draws the mandala)
  // and where the movements change, and for a window its size and frames.
  const keyFile = path.join(dir, `${prefix}layers.json`);
  const whole = from === 0 && to === analysis.frames && size === LANDSCAPE;
  const key = JSON.stringify({ presets: brief.movements.map(m => m.preset), palette: brief.palette, symmetry: brief.symmetry, ...(brief.kind ? { kind: brief.kind } : {}), edges, ...(whole ? {} : { size, from, to }) });
  if (fs.existsSync(milkdropFile) && fs.existsSync(mandalaFile) && fs.existsSync(keyFile) && fs.readFileSync(keyFile, 'utf8') === key) return { milkdropFile, mandalaFile };

  const { width: W, height: H } = size;
  const look = brief.kind ? lookOf(brief.kind).style : DEFAULT_STYLE;
  const { browser, page } = await butterchurnPage(W, H);
  try {
    await page.evaluate(pageSetup, {
      W, H, fps, packs: PACKS, presets: brief.movements.map(m => m.preset), palette: brief.palette, symmetry: brief.symmetry || 8, style: look, edges, from
    });

    const tmpMilk = milkdropFile.replace(/\.mp4$/, '.part.mp4');
    const tmpMandala = mandalaFile.replace(/\.mp4$/, '.part.mp4');
    const milk = encoder(tmpMilk, fps);
    const mandala = encoder(tmpMandala, fps);
    const started = Date.now();
    for (let f = from; f < to; f += BATCH) {
      const batch = [];
      for (let i = f; i < Math.min(to, f + BATCH); i++) batch.push([i, analysis.waveform(i), analysis.bands(i)]);
      const images = await page.evaluate(items => items.map(([i, w, s]) => window.renderFrame(i, w, s)), batch);
      for (const [a, b] of images) {
        await milk.write(Buffer.from(a.slice(a.indexOf(',') + 1), 'base64'));
        await mandala.write(Buffer.from(b.slice(b.indexOf(',') + 1), 'base64'));
      }
      if (((f - from) / BATCH) % 40 === 0) log(`  frame ${f - from}/${to - from} (${((Date.now() - started) / 1000).toFixed(0)}s)`);
    }
    await Promise.all([milk.end(), mandala.end()]);
    fs.renameSync(tmpMilk, milkdropFile);
    fs.renameSync(tmpMandala, mandalaFile);
    fs.writeFileSync(keyFile, key);
    log(`  rendered ${to - from} frames in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  } finally {
    await browser.close();
  }
  return { milkdropFile, mandalaFile };
}

// The survey: each preset played for a few seconds of a spoken recording,
// measured for how bright it is (mean luma, 0 to 1) and how much it moves
// (mean change between samples). Many presets stay near black under a voice;
// the brief is only offered the ones that show up. Kept in presets.json.
const SURVEY_FILE = path.join(__dirname, 'presets.json');

function pageSurvey({ W, H, fps, packs }) {
  const bc = window.butterchurn.default || window.butterchurn;
  const all = {};
  for (const pack of packs) Object.assign(all, (window[pack].getPresets || window[pack].default.getPresets)());
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const viz = bc.createVisualizer(new AudioContext({ sampleRate: 44100 }), canvas, { width: W, height: H, pixelRatio: 1, textureRatio: 1 });
  const small = document.createElement('canvas');
  small.width = 64; small.height = 36;
  const sg = small.getContext('2d', { willReadFrequently: true });
  window.surveyNames = Object.keys(all);
  window.measure = (name, waves) => {
    viz.loadPreset(all[name], 0);
    let light = 0, change = 0, samples = 0, previous = null;
    waves.forEach((wave, i) => {
      viz.render({ audioLevels: { timeByteArray: Uint8Array.from(wave.mono), timeByteArrayL: Uint8Array.from(wave.left), timeByteArrayR: Uint8Array.from(wave.right) }, elapsedTime: 1 / fps });
      if (i < fps || i % 5) return;
      sg.drawImage(canvas, 0, 0, 64, 36);
      const px = sg.getImageData(0, 0, 64, 36).data;
      const luma = new Float32Array(64 * 36);
      for (let p = 0; p < luma.length; p++) luma[p] = (0.2126 * px[4 * p] + 0.7152 * px[4 * p + 1] + 0.0722 * px[4 * p + 2]) / 255;
      light += luma.reduce((s, v) => s + v, 0) / luma.length;
      if (previous) change += luma.reduce((s, v, p) => s + Math.abs(v - previous[p]), 0) / luma.length;
      previous = luma;
      samples++;
    });
    return { brightness: +(light / samples).toFixed(3), motion: +(change / Math.max(1, samples - 1)).toFixed(3) };
  };
}

async function surveyPresets(analysis, { from = 20, seconds = 6, fps = 30, log = console.log } = {}) {
  const { browser, page } = await butterchurnPage(640, 360);
  try {
    await page.evaluate(pageSurvey, { W: 640, H: 360, fps, packs: PACKS });
    const names = await page.evaluate(() => window.surveyNames);
    const waves = Array.from({ length: seconds * fps }, (_, i) => analysis.waveform(from * fps + i));
    const survey = {};
    for (const [i, name] of names.entries()) {
      try {
        survey[name] = await page.evaluate(([n, w]) => window.measure(n, w), [name, waves]);
      } catch (err) {
        survey[name] = { error: err.message.slice(0, 100) };
      }
      if (i % 50 === 0) log(`  surveyed ${i}/${names.length}`);
    }
    fs.writeFileSync(SURVEY_FILE, JSON.stringify(survey, null, 1) + '\n');
    return survey;
  } finally {
    await browser.close();
  }
}

// The presets the brief may choose from, with how they look under a voice:
// those bright enough to show, and the Cream of the Crop eight, chosen by eye
// as shapes on black, which an average over the frame scores low (a lotus
// lights a twentieth of it) though screen-blended they show clearly.
function presetChoices({ minBrightness = 0.1 } = {}) {
  const survey = JSON.parse(fs.readFileSync(SURVEY_FILE, 'utf8'));
  return Object.entries(survey)
    .filter(([name, s]) => !s.error && (s.brightness >= minBrightness || name in CREAM))
    .map(([name, s]) => ({ name, ...s }));
}

module.exports = { renderLayers, surveyPresets, presetChoices };
