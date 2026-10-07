/**
 * The site player. church-private/docs/plans/audio-player-2026-10-05.md has
 * the plan.
 *
 * One <audio> for the whole visit, held here and never in the page, so it
 * keeps playing while site-nav.js changes pages around it. Once something
 * plays, a bar at the bottom of every page shows it: play and pause, 15-second
 * skips, the waveform as the progress bar, speed, and on phones a sheet with
 * all of them. A document's own player (lib/audio/markup.js), a reading
 * path's "Listen to this path" and the home page's service, with its one
 * waveform across every part and a button for each, are remotes for it, so
 * the page and the bar can never disagree.
 *
 * It also writes the lock screen's card (Media Session), resumes after a full
 * load, paused, from the browser's own storage, lets one tab play at a time,
 * and draws the visual on a document's page while its recording plays.
 *
 * What it never does: record plays, count listeners, send anything about
 * listening anywhere, start on arrival, or play a piece the listener did not
 * choose. Everything it keeps is in this browser's localStorage.
 *
 * The visual reads precomputed frames (lib/audio/frames.js) against the
 * player's position. It never routes the audio through Web Audio: an iPhone
 * with its silent switch on plays <audio> but not Web Audio, so an analyser
 * would silence the recording for those listeners.
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------------
  // Pure helpers, exported for node:test.

  const RATES = [0.75, 1, 1.25, 1.5];
  const SKIP_SECONDS = 15;
  const ARROW_SECONDS = 5;

  const pad = n => String(n).padStart(2, '0');

  function clock(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
  }

  // "4 minutes, 3 seconds": what a screen reader says for the position,
  // rather than "4:03", which it reads as a ratio or a time of day.
  function spoken(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    const unit = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const parts = [];
    if (s >= 3600) parts.push(unit(Math.floor(s / 3600), 'hour'));
    if (s % 3600 >= 60) parts.push(unit(Math.floor((s % 3600) / 60), 'minute'));
    if (s % 60 || !parts.length) parts.push(unit(s % 60, 'second'));
    return parts.join(', ');
  }

  // The WAI-ARIA media seek slider's keys: arrows 5 seconds, Page Up and Page
  // Down 15, Home and End to the ends. Null for any other key.
  function seekForKey(key, current, duration) {
    const to = t => Math.max(0, Math.min(duration, t));
    switch (key) {
      case 'ArrowLeft':
      case 'ArrowDown': return to(current - ARROW_SECONDS);
      case 'ArrowRight':
      case 'ArrowUp': return to(current + ARROW_SECONDS);
      case 'PageDown': return to(current - SKIP_SECONDS);
      case 'PageUp': return to(current + SKIP_SECONDS);
      case 'Home': return 0;
      case 'End': return duration;
      default: return null;
    }
  }

  // At most `max` values, each the louder of those it covers.
  function fitPeaks(peaks, max) {
    if (peaks.length <= max) return peaks.slice();
    return Array.from({ length: max }, (_, i) => {
      const from = Math.floor((i * peaks.length) / max);
      const to = Math.max(Math.floor(((i + 1) * peaks.length) / max), from + 1);
      return Math.max(...peaks.slice(from, to));
    });
  }

  // A frames file's bytes (lib/audio/frames.js), or null.
  function parseFrames(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 6 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'ACF1') return null;
    const bands = bytes[5];
    return { fps: bytes[4], bands, count: Math.floor((bytes.length - 6) / (1 + bands)), bytes };
  }

  // Loudness (0 to 1.25) and the bands (0 to 1) at time t, between frames.
  function frameAt(frames, t) {
    const stride = 1 + frames.bands;
    const at = Math.max(0, Math.min(frames.count - 1, t * frames.fps));
    const i = Math.floor(at);
    const j = Math.min(frames.count - 1, i + 1);
    const f = at - i;
    const value = (frame, k) => frames.bytes[6 + frame * stride + k];
    const mix = k => (value(i, k) * (1 - f) + value(j, k) * f) / 255;
    const bands = new Float32Array(frames.bands);
    for (let b = 0; b < frames.bands; b++) bands[b] = mix(1 + b);
    return { loud: mix(0) * 1.25, bands };
  }

  // The cue speaking at t, or the one before it in a silence, or the first
  // before anyone speaks. Cues are [start, end, voice mask], in order.
  function cueAt(cues, t) {
    if (!cues || !cues.length) return null;
    let lo = 0;
    let hi = cues.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (cues[mid][0] <= t) lo = mid;
      else hi = mid - 1;
    }
    return cues[lo];
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // A colour along a ramp of stops, t from 0 to 1.
  function colorAt(ramp, t) {
    const stops = ramp.map(c => (typeof c === 'string' ? hexToRgb(c) : c));
    const at = Math.min(1, Math.max(0, t)) * (stops.length - 1);
    const i = Math.min(Math.floor(at), stops.length - 2);
    const f = at - i;
    return stops[i].map((a, k) => Math.round(a + (stops[i + 1][k] - a) * f));
  }

  // A queue laid end to end as one timeline, by each track's own length:
  // where each begins, and the whole. A service's page draws one waveform
  // across it, the way a single file would have one.
  function queueTimeline(tracks) {
    const starts = [];
    let total = 0;
    for (const t of tracks) {
      starts.push(total);
      total += t.seconds || 0;
    }
    return { starts, total };
  }

  // Where a time on that timeline falls: the track, and how far into it.
  function queueAt(tracks, at) {
    const { starts, total } = queueTimeline(tracks);
    const t = Math.min(Math.max(0, at), Math.max(0, total - 0.01));
    let index = starts.length - 1;
    while (index > 0 && starts[index] > t) index--;
    return { index, offset: t - starts[index] };
  }

  // The queue's waveform: n bars across the whole timeline, each the loudest
  // of the peaks it covers, so a track's share of the bars is its share of
  // the time. A track without peaks draws at a middle height.
  function queuePeaks(tracks, n) {
    const { starts, total } = queueTimeline(tracks);
    if (!total) return [];
    return Array.from({ length: n }, (_, b) => {
      const from = (b / n) * total;
      const to = ((b + 1) / n) * total;
      let max = 0;
      tracks.forEach((t, i) => {
        const begin = starts[i];
        const end = begin + (t.seconds || 0);
        if (end <= from || begin >= to || !t.seconds) return;
        if (!t.peaks || !t.peaks.length) {
          max = Math.max(max, 128);
          return;
        }
        const k0 = Math.floor(((Math.max(from, begin) - begin) / t.seconds) * t.peaks.length);
        const k1 = Math.max(k0 + 1, Math.ceil(((Math.min(to, end) - begin) / t.seconds) * t.peaks.length));
        for (let k = k0; k < Math.min(k1, t.peaks.length); k++) max = Math.max(max, t.peaks[k]);
      });
      return max;
    });
  }

  // Where to join a queue that keeps time, as a service does. Its clock is
  // the service's length with the silence after each part (loop), and where
  // it stood at a moment (at, at asOf in ms); each track knows where it
  // starts on that clock. The track in progress, part way in; in a silence
  // between, the next to begin; after the last, the first.
  function joinAt(tracks, clock, nowMs) {
    const t = ((clock.at + (nowMs - clock.asOf) / 1000) % clock.loop + clock.loop) % clock.loop;
    const found = tracks.findIndex(track => t < track.start + track.seconds);
    return found === -1 ? { index: 0, at: 0 } : { index: found, at: Math.max(0, t - tracks[found].start) };
  }

  // Whether two queues are the same: the same name and the same tracks in
  // order. A name alone is not enough: a service's page can be older or
  // newer than the queue playing, and a queue restored from storage can come
  // from an earlier form of the page.
  function sameQueue(a, b) {
    return !!(a && b && a.name === b.name && a.tracks.length === b.tracks.length &&
      a.tracks.every((t, i) => t.file === b.tracks[i].file));
  }

  // What follows the track a queue is on, or null when it is done. A queue
  // joined part way (wrapTo, where it was joined) goes on round from the
  // first track and stops before the one it began with, so each plays once.
  function nextInQueue(q) {
    const n = q.tracks.length;
    if (q.wrapTo == null) return q.index + 1 < n ? q.index + 1 : null;
    const next = (q.index + 1) % n;
    return next === q.wrapTo ? null : next;
  }

  const helpers = { clock, spoken, seekForKey, fitPeaks, parseFrames, frameAt, cueAt, colorAt, queueTimeline, queueAt, queuePeaks, joinAt, nextInQueue, sameQueue, RATES, SKIP_SECONDS };
  if (typeof module === 'object' && module.exports) {
    module.exports = helpers;
    return;
  }
  if (root.achurchPlayer) return;

  // ------------------------------------------------------------------
  // State, kept in this browser only.

  const KEY_RESUME = 'achurch.player.resume';
  const KEY_RATE = 'achurch.player.rate';
  const KEY_PLAYING = 'achurch.player.playing';
  const RESUME_MS = 12 * 60 * 60 * 1000;
  const tab = Math.random().toString(36).slice(2);

  const store = {
    get(key) {
      try { return JSON.parse(localStorage.getItem(key)); } catch (err) { return null; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* private mode: nothing is kept */ }
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch (err) { /* nothing to remove */ }
    },
  };

  const reducedMotion = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  // The theme the page is drawn in (theme.js, styles.css), which the visual
  // follows: a visitor's choice on <html>, or else the device's setting.
  const isDark = () => root.getComputedStyle(root.document.documentElement).colorScheme === 'dark';
  const audio = new Audio();
  audio.preload = 'none';

  let track = null;      // what the player holds
  let loaded = null;     // the file the element has as its source
  let queue = null;      // { name, title, href, unit, tracks, index, wrapTo } while a path or a service plays
  let pendingAt = 0;     // where to start, before the element knows the length
  let startedAt = 0;
  let rate = RATES.includes(store.get(KEY_RATE)) ? store.get(KEY_RATE) : 1;
  let lastSaved = 0;
  let raf = 0;
  let page = null;       // this page's own player, if it has one
  let path = null;       // this page's "Listen to this path", if it has one

  const duration = () => (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (track ? track.seconds : 0));
  const position = () => (loaded && audio.readyState > 0 ? audio.currentTime : pendingAt);
  const isCurrent = t => !!(track && t && track.file === t.file);

  function load(next, at) {
    track = next;
    loaded = next.file;
    pendingAt = at || 0;
    audio.src = `/audio/${next.file}${pendingAt ? `#t=${pendingAt.toFixed(1)}` : ''}`;
    audio.defaultPlaybackRate = rate;
    audio.playbackRate = rate;
    bar.show();
    setSession();
    render();
  }

  // Called inside the listener's own press, as iOS requires for play(). A
  // piece from the playing path keeps the path, at that reading; any other
  // piece leaves it.
  function play(next, at) {
    if (!next) return;
    if (queue) {
      const index = queue.tracks.findIndex(t => t.file === next.file);
      if (index === -1) queue = null;
      else queue.index = index;
    }
    if (!isCurrent(next) || loaded !== next.file) load(next, at != null ? at : (isCurrent(next) ? pendingAt : 0));
    else if (at != null) seek(at);
    startedAt = Date.now();
    store.set(KEY_PLAYING, { tab, startedAt });
    const started = audio.play();
    if (started && started.catch) started.catch(() => render());
  }

  function pause() {
    audio.pause();
  }

  function toggle(next) {
    if (isCurrent(next) && !audio.paused) pause();
    else play(next || track);
  }

  function seek(at) {
    const to = Math.max(0, Math.min(duration() || at, at));
    pendingAt = to;
    if (loaded) audio.currentTime = to;
    positionState();
    render();
    drawVisual();
  }

  const skip = by => seek(position() + by);

  // at: where in that track to begin. wrap: a queue joined part way goes on
  // round from the first track until it reaches this one again.
  function playQueue(q, index, at = 0, { wrap = false } = {}) {
    queue = { name: q.name, title: q.title, href: q.href, unit: q.unit || 'Reading', tracks: q.tracks, index, wrapTo: wrap ? index : null };
    play(q.tracks[index], at);
  }

  function step(by) {
    if (!queue) return;
    const n = queue.tracks.length;
    const index = queue.wrapTo == null ? queue.index + by : (queue.index + by + n) % n;
    if (index < 0 || index >= n) return;
    queue.index = index;
    play(queue.tracks[index], 0);
  }

  function close() {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    track = null;
    loaded = null;
    queue = null;
    pendingAt = 0;
    store.remove(KEY_RESUME);
    clearSession();
    bar.hide();
    render();
    drawVisual();
  }

  function setRate(next) {
    rate = next;
    store.set(KEY_RATE, rate);
    audio.defaultPlaybackRate = rate;
    audio.playbackRate = rate;
    positionState();
    render();
  }

  // ------------------------------------------------------------------
  // Resume, one tab at a time.

  function save() {
    if (!track) return;
    lastSaved = Date.now();
    store.set(KEY_RESUME, { v: 1, track, queue, position: position(), savedAt: lastSaved });
  }

  // After a full load, deploys included: the bar comes back paused at its
  // place. Nothing plays until the listener presses play.
  function restore() {
    const saved = store.get(KEY_RESUME);
    if (!saved || saved.v !== 1 || !saved.track || !(Date.now() - saved.savedAt < RESUME_MS)) {
      store.remove(KEY_RESUME);
      return;
    }
    track = saved.track;
    queue = saved.queue || null;
    pendingAt = saved.position || 0;
    bar.show();
    setSession();
  }

  root.addEventListener('storage', e => {
    if (e.key !== KEY_PLAYING || !e.newValue) return;
    let other = null;
    try { other = JSON.parse(e.newValue); } catch (err) { return; }
    if (other && other.tab !== tab && other.startedAt > startedAt && !audio.paused) pause();
  });

  root.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) save();
    else if (!audio.paused) startLoop();
  });

  // A change of theme, chosen in the footer or the device's own, redraws the
  // visual, which reads the theme as it draws. Both last the whole visit, as
  // the player does.
  if (root.MutationObserver) {
    new root.MutationObserver(() => drawVisual()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
  if (root.matchMedia) root.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => drawVisual());

  // ------------------------------------------------------------------
  // The element's events.

  audio.addEventListener('loadedmetadata', () => {
    if (pendingAt && Math.abs(audio.currentTime - pendingAt) > 1) audio.currentTime = pendingAt;
    positionState();
    render();
  });
  audio.addEventListener('play', () => {
    setPlaybackState('playing');
    startLoop();
    render();
  });
  audio.addEventListener('pause', () => {
    setPlaybackState('paused');
    save();
    render();
    drawVisual();
  });
  audio.addEventListener('timeupdate', () => {
    if (Date.now() - lastSaved > 5000) save();
    positionState();
    if (audio.paused) render();
  });
  audio.addEventListener('ratechange', positionState);
  audio.addEventListener('error', () => {
    if (!loaded) return;
    announce('This recording could not be played. Please try again.');
    render();
  });
  audio.addEventListener('ended', () => {
    const following = queue ? nextInQueue(queue) : null;
    if (following != null) {
      queue.index = following;
      const next = queue.tracks[queue.index];
      load(next, 0);
      const started = audio.play();
      if (started && started.catch) started.catch(() => render());
      announce(`Now playing ${next.title}, ${(queue.unit || 'Reading').toLowerCase()} ${queue.index + 1} of ${queue.tracks.length}`);
      return;
    }
    pendingAt = 0;
    store.remove(KEY_RESUME);
    render();
    drawVisual();
  });

  // ------------------------------------------------------------------
  // The lock screen. Every call guarded: a platform without an action
  // throws, and the card is a nicety while the audio is the product.

  const session = root.navigator && root.navigator.mediaSession;

  function handle(action, fn) {
    if (!session) return;
    try { session.setActionHandler(action, fn); } catch (err) { /* not on this platform */ }
  }

  // The lock screen shows one pair: previous and next while a path plays,
  // the 15-second skips otherwise.
  function setSession() {
    if (!session || !track) return;
    try {
      session.metadata = new root.MediaMetadata({
        title: track.title,
        artist: 'aChurch.ai',
        album: queue ? queue.title : track.album,
        artwork: [{ src: track.artwork, sizes: '512x512', type: 'image/png' }],
      });
    } catch (err) { /* no MediaMetadata here */ }
    handle('play', () => play(track));
    handle('pause', pause);
    handle('stop', close);
    handle('seekto', d => seek(d.seekTime));
    if (queue) {
      handle('previoustrack', () => step(-1));
      handle('nexttrack', () => step(1));
      handle('seekbackward', null);
      handle('seekforward', null);
    } else {
      handle('seekbackward', d => skip(-(d.seekOffset || SKIP_SECONDS)));
      handle('seekforward', d => skip(d.seekOffset || SKIP_SECONDS));
      handle('previoustrack', null);
      handle('nexttrack', null);
    }
  }

  function setPlaybackState(state) {
    if (!session) return;
    try { session.playbackState = state; } catch (err) { /* unsupported */ }
  }

  function positionState() {
    if (!session || !session.setPositionState || !track) return;
    const d = duration();
    if (!d) return;
    try { session.setPositionState({ duration: d, playbackRate: audio.playbackRate || 1, position: Math.min(position(), d) }); } catch (err) { /* out of range */ }
  }

  function clearSession() {
    if (!session) return;
    try { session.metadata = null; } catch (err) { /* unsupported */ }
    setPlaybackState('none');
  }

  // ------------------------------------------------------------------
  // The bar, built on the first play or resume, kept across pages
  // (data-persist), and laid out above the page's bottom.

  const ICONS = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="icon-play" d="M8 5.5v13l11-6.5z"/><path class="icon-pause" d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/><text x="12" y="16.5" text-anchor="middle" font-size="7" font-family="inherit">15</text></svg>',
    fwd: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5V2l5 4-5 4V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z"/><text x="12" y="16.5" text-anchor="middle" font-size="7" font-family="inherit">15</text></svg>',
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 15l6-6 6 6-1.4 1.4L12 11.8l-4.6 4.6z"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z"/></svg>',
  };

  const controls = `
          <button type="button" class="pb-btn pb-prev" aria-label="Previous reading" hidden>${ICONS.prev}</button>
          <button type="button" class="pb-btn pb-back" aria-label="Back 15 seconds">${ICONS.back}</button>
          <button type="button" class="pb-btn pb-play" aria-label="Play">${ICONS.play}</button>
          <button type="button" class="pb-btn pb-fwd" aria-label="Forward 15 seconds">${ICONS.fwd}</button>
          <button type="button" class="pb-btn pb-next" aria-label="Next reading" hidden>${ICONS.next}</button>`;

  const bar = {
    el: null,
    show() {
      if (!this.el) build();
      this.el.hidden = false;
      document.documentElement.classList.add('has-player');
      measureBar();
    },
    hide() {
      if (!this.el) return;
      const sheet = this.el.querySelector('.pb-sheet');
      if (sheet.open) sheet.close();
      this.el.hidden = true;
      document.documentElement.classList.remove('has-player');
      document.documentElement.style.removeProperty('--player-bar-height');
    },
  };

  let statusEl = null;
  function announce(text) {
    if (!statusEl) return;
    statusEl.textContent = '';
    setTimeout(() => { statusEl.textContent = text; }, 50);
  }

  function measureBar() {
    const section = bar.el && bar.el.querySelector('.player-bar');
    if (!section || bar.el.hidden) return;
    document.documentElement.style.setProperty('--player-bar-height', `${Math.ceil(section.getBoundingClientRect().height)}px`);
  }

  function build() {
    const el = document.createElement('div');
    el.id = 'site-player';
    el.setAttribute('data-persist', '');
    el.hidden = true;
    el.innerHTML = `
      <section class="player-bar" aria-label="Audio player">
        <div class="pb-line" aria-hidden="true"><span></span></div>
        <div class="pb-controls">${controls}
        </div>
        <div class="pb-text">
          <a class="pb-title" href="/"></a>
          <span class="pb-sub"></span>
        </div>
        <div class="pb-wave doc-audio-wave"></div>
        <span class="pb-time"></span>
        <button type="button" class="pb-btn pb-rate"></button>
        <button type="button" class="pb-btn pb-more" aria-label="All controls" aria-haspopup="dialog">${ICONS.more}</button>
        <button type="button" class="pb-btn pb-close" aria-label="Close the player">${ICONS.close}</button>
      </section>
      <dialog class="pb-sheet" aria-label="Audio player">
        <div class="pb-sheet-head">
          <div class="pb-text">
            <a class="pb-title" href="/"></a>
            <span class="pb-sub"></span>
          </div>
          <button type="button" class="pb-btn pb-sheet-close" aria-label="Close these controls">${ICONS.close}</button>
        </div>
        <div class="pb-wave doc-audio-wave"></div>
        <span class="pb-time"></span>
        <div class="pb-controls">${controls}
        </div>
        <button type="button" class="pb-btn pb-rate"></button>
      </dialog>
      <div class="visually-hidden pb-status" aria-live="polite"></div>`;
    document.body.appendChild(el);
    bar.el = el;
    statusEl = el.querySelector('.pb-status');

    const all = selector => el.querySelectorAll(selector);
    all('.pb-play').forEach(b => b.addEventListener('click', () => toggle(track)));
    all('.pb-back').forEach(b => b.addEventListener('click', () => skip(-SKIP_SECONDS)));
    all('.pb-fwd').forEach(b => b.addEventListener('click', () => skip(SKIP_SECONDS)));
    all('.pb-prev').forEach(b => b.addEventListener('click', () => step(-1)));
    all('.pb-next').forEach(b => b.addEventListener('click', () => step(1)));
    all('.pb-rate').forEach(b => b.addEventListener('click', () => setRate(RATES[(RATES.indexOf(rate) + 1) % RATES.length])));
    all('.pb-wave').forEach(w => slider(w, () => track));
    const sheet = el.querySelector('.pb-sheet');
    el.querySelector('.pb-more').addEventListener('click', () => sheet.showModal());
    el.querySelector('.pb-sheet-close').addEventListener('click', () => sheet.close());
    el.querySelector('.pb-close').addEventListener('click', close);
    sheet.addEventListener('click', e => { if (e.target === sheet) sheet.close(); });
    if (root.ResizeObserver) new root.ResizeObserver(measureBar).observe(el.querySelector('.player-bar'));
  }

  // ------------------------------------------------------------------
  // Waveforms and sliders.

  function barsHtml(peaks, max, kind) {
    const fitted = fitPeaks(peaks, max);
    const spans = fitted.map((p, i) => `<span style="--i:${i};height:${Math.max(14, Math.round((p / 255) * 100))}%"><i></i></span>`).join('');
    return `<span class="doc-audio-bars doc-audio-bars-${kind}" style="--n:${fitted.length}" aria-hidden="true">${spans}</span>`;
  }

  let drawnPeaksFor = null;
  function drawBarWaves() {
    if (!bar.el || !track || drawnPeaksFor === track.file) return;
    drawnPeaksFor = track.file;
    bar.el.querySelectorAll('.pb-wave').forEach(w => {
      w.innerHTML = track.peaks ? barsHtml(track.peaks, 128, 'wide') + barsHtml(track.peaks, 64, 'narrow') : '<span class="pb-wave-line"><i></i></span>';
    });
  }

  // A waveform as the APG media seek slider. `owner` says whose recording it
  // is: the bar's is whatever plays; a page's is its own, and pressing it
  // starts that recording from where it was pressed.
  function slider(el, owner) {
    el.setAttribute('role', 'slider');
    el.tabIndex = 0;
    el.setAttribute('aria-valuemin', '0');
    const target = () => owner();
    const length = t => (isCurrent(t) ? duration() : (t ? t.seconds : 0));
    el.addEventListener('keydown', e => {
      const t = target();
      if (!t || !isCurrent(t)) return;
      const to = seekForKey(e.key, position(), duration());
      if (to == null) return;
      e.preventDefault();
      seek(to);
    });
    let dragging = false;
    const atPointer = e => {
      const t = target();
      const box = el.getBoundingClientRect();
      if (!t || box.width <= 0) return;
      const at = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)) * length(t);
      if (isCurrent(t)) seek(at);
      else play(t, at);
    };
    el.addEventListener('pointerdown', e => {
      if (!target()) return;
      dragging = true;
      if (el.setPointerCapture) el.setPointerCapture(e.pointerId);
      atPointer(e);
    });
    el.addEventListener('pointermove', e => { if (dragging) atPointer(e); });
    el.addEventListener('pointerup', () => { dragging = false; });
    el.addEventListener('pointercancel', () => { dragging = false; });
  }

  // where: for a queue's slider, the track the position falls in.
  function setSlider(el, t, length, label, where) {
    const now = Math.floor(t);
    if (el.dataset.second === String(now) && el.dataset.length === String(Math.floor(length))) return;
    el.dataset.second = String(now);
    el.dataset.length = String(Math.floor(length));
    el.setAttribute('aria-valuemax', String(Math.floor(length)));
    el.setAttribute('aria-valuenow', String(now));
    el.setAttribute('aria-valuetext', `${spoken(t)} of ${spoken(length)}${where ? `, in ${where}` : ''}`);
    if (label) el.setAttribute('aria-label', label);
  }

  // A queue's waveform, wide and narrow as a recording's is, with a tick
  // where each track after the first begins.
  function queueBarsHtml(tracks) {
    const { starts, total } = queueTimeline(tracks);
    const ticks = starts.slice(1).map(at => `<span style="left:${((at / total) * 100).toFixed(3)}%"></span>`).join('');
    return `${barsHtml(queuePeaks(tracks, 128), 128, 'wide')}${barsHtml(queuePeaks(tracks, 64), 64, 'narrow')}<span class="queue-ticks" aria-hidden="true">${ticks}</span>`;
  }

  // Whether the queue playing is this page's (sameQueue).
  const isOurs = q => sameQueue(queue, q);

  // Where this page's queue stands on its timeline: its playing track's
  // start plus how far into it, or 0 when something else plays.
  function queuePosition() {
    if (!path || !isOurs(path.queue)) return 0;
    const t = path.queue.tracks[queue.index];
    return path.timeline.starts[queue.index] + Math.min(position(), t ? t.seconds : 0);
  }

  // A queue's waveform as one slider across the whole timeline: a press, a
  // drag or the keys find the track at that point and play it from there.
  function queueSlider(el) {
    el.setAttribute('role', 'slider');
    el.tabIndex = 0;
    el.setAttribute('aria-valuemin', '0');
    const go = at => {
      if (!path) return;
      const q = path.queue;
      const { index, offset } = queueAt(q.tracks, at);
      if (isOurs(q)) {
        if (index === queue.index) seek(offset);
        else play(queue.tracks[index], offset);
      } else {
        playQueue(q, index, offset);
      }
    };
    el.addEventListener('keydown', e => {
      if (!path || !isOurs(path.queue)) return;
      const to = seekForKey(e.key, queuePosition(), path.timeline.total);
      if (to == null) return;
      e.preventDefault();
      go(to);
    });
    let dragging = false;
    const atPointer = e => {
      const box = el.getBoundingClientRect();
      if (!path || box.width <= 0) return;
      go(Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)) * path.timeline.total);
    };
    el.addEventListener('pointerdown', e => {
      if (!path) return;
      dragging = true;
      if (el.setPointerCapture) el.setPointerCapture(e.pointerId);
      atPointer(e);
    });
    el.addEventListener('pointermove', e => { if (dragging) atPointer(e); });
    el.addEventListener('pointerup', () => { dragging = false; });
    el.addEventListener('pointercancel', () => { dragging = false; });
  }

  // ------------------------------------------------------------------
  // Drawing the state everywhere it shows.

  function render() {
    const d = duration();
    const t = position();
    const playing = !!track && !audio.paused;
    const fraction = d ? Math.min(1, t / d) : 0;

    if (bar.el && track) {
      drawBarWaves();
      const el = bar.el;
      el.classList.toggle('is-playing', playing);
      el.querySelectorAll('.pb-play').forEach(b => b.setAttribute('aria-label', playing ? 'Pause' : 'Play'));
      el.querySelectorAll('.pb-title').forEach(a => {
        if (a.textContent !== track.title) a.textContent = track.title;
        a.setAttribute('href', track.href);
      });
      const sub = queue ? `${queue.unit || 'Reading'} ${queue.index + 1} of ${queue.tracks.length}: ${queue.title}` : track.album;
      el.querySelectorAll('.pb-sub').forEach(s => { if (s.textContent !== sub) s.textContent = sub; });
      el.querySelectorAll('.pb-time').forEach(s => { s.textContent = `${clock(t)} / ${clock(d)}`; });
      el.querySelectorAll('.pb-wave').forEach(w => {
        w.style.setProperty('--progress', fraction);
        setSlider(w, t, d, `Position in ${track.title}`);
      });
      el.querySelector('.pb-line span').style.width = `${fraction * 100}%`;
      el.querySelectorAll('.pb-rate').forEach(b => {
        b.textContent = `${rate}×`;
        b.setAttribute('aria-label', `Speed, ${rate} times. Change`);
      });
      // Previous and next say what they step through: a path's readings, a
      // service's parts.
      const unit = ((queue && queue.unit) || 'Reading').toLowerCase();
      el.querySelectorAll('.pb-prev').forEach(b => {
        b.hidden = !queue;
        b.disabled = !queue || (queue.wrapTo == null && queue.index === 0);
        if (b.getAttribute('aria-label') !== `Previous ${unit}`) b.setAttribute('aria-label', `Previous ${unit}`);
      });
      el.querySelectorAll('.pb-next').forEach(b => {
        b.hidden = !queue;
        b.disabled = !queue || (queue.wrapTo == null && queue.index >= queue.tracks.length - 1);
        if (b.getAttribute('aria-label') !== `Next ${unit}`) b.setAttribute('aria-label', `Next ${unit}`);
      });
    }

    if (page) {
      const current = isCurrent(page.track);
      if (current) needFrames(page);
      const pt = current ? t : 0;
      const length = current ? d : page.track.seconds;
      page.fig.classList.toggle('is-current', current);
      page.fig.classList.toggle('is-playing', current && playing);
      page.play.setAttribute('aria-label', `${current && playing ? 'Pause' : 'Play'} ${page.track.title}`);
      page.time.textContent = `${clock(pt)} / ${clock(length)}`;
      if (page.wave) {
        page.wave.style.setProperty('--progress', current && length ? Math.min(1, pt / length) : 0);
        setSlider(page.wave, pt, length);
      }
    }

    if (path) {
      const ours = isOurs(path.queue);
      const noun = path.queue.noun || 'path';
      const labels = path.queue.labels || {};
      path.el.classList.toggle('is-playing', ours && playing);
      const said = ours
        ? (playing ? labels.pause || `Pause this ${noun}` : labels.resume || `Resume this ${noun}`)
        : labels.start || `Listen to this ${noun}`;
      // The name is also set outright: some agents' readers of the page take
      // a button's name only from its label, not from the text inside it.
      if (path.label.textContent !== said) path.label.textContent = said;
      if (path.button.getAttribute('aria-label') !== said) path.button.setAttribute('aria-label', said);
      if (path.wave || path.time || path.rows.length) {
        const at = queuePosition();
        const total = path.timeline.total;
        const here = path.queue.tracks[ours ? queue.index : 0];
        if (path.wave) {
          path.wave.style.setProperty('--progress', total ? Math.min(1, at / total) : 0);
          setSlider(path.wave, at, total, `Position in ${path.queue.title}`, here && here.title);
        }
        if (path.time) path.time.textContent = `${clock(at)} / ${clock(total)}`;
        path.rows.forEach((row, i) => {
          row.classList.toggle('is-current', ours && i === queue.index);
          row.classList.toggle('is-playing', ours && playing && i === queue.index);
        });
        path.items.forEach((item, i) => {
          const label = `${ours && playing && i === queue.index ? 'Pause' : 'Play'} ${path.queue.tracks[i].title}`;
          if (item.getAttribute('aria-label') !== label) item.setAttribute('aria-label', label);
        });
      }
    }
  }

  function loop() {
    raf = 0;
    render();
    drawVisual();
    if (!audio.paused && !document.hidden) raf = root.requestAnimationFrame(loop);
  }

  function startLoop() {
    if (!raf) raf = root.requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------------
  // The visual: the voice-band figure the music-videos project calls siri.
  // Five sine layers in a spindle closed at both ends, each at a spatial
  // frequency that never locks with the others (0.7 to 3.5) and its own
  // phase rate; the height follows the recording's loudness and, across the
  // width, its voice bands. Coloured by who is speaking.

  const RAMPS = {
    site: ['#0a0e1a', '#0b3a4a', '#00b8d4', '#7fe3f0', '#e8fbff'],
    matthew: ['#071a22', '#0b4f63', '#00b8d4', '#7fe3f0', '#e8fbff'],
    luca: ['#120f2e', '#2f2a7a', '#7c6cff', '#b9b0ff', '#f0edff'],
    amaya: ['#2a1406', '#7a3a12', '#f0913c', '#f7c48c', '#fff3e4'],
  };
  const LAYERS = 5;
  const PHASE_RATE = 0.5;     // radians a second: a third of the reference's
  const REST = { loud: 0.2, phase: 0.9 };
  const framesCache = new Map();
  const shown = { loud: REST.loud, bands: null, colors: null };

  function framesFor(t) {
    if (!t.frames) return Promise.resolve(null);
    if (!framesCache.has(t.frames)) {
      framesCache.set(t.frames, fetch(`/audio/${t.frames}`)
        .then(r => (r.ok ? r.arrayBuffer() : null))
        .then(b => (b ? parseFrames(b) : null))
        .catch(() => null));
    }
    return framesCache.get(t.frames);
  }

  function rampsFor(t, at) {
    const cue = cueAt(t.cues, at);
    if (!cue || !t.order) return Array(LAYERS).fill(RAMPS.site);
    const voices = t.order.filter((_, i) => cue[2] & (1 << i));
    if (!voices.length) return Array(LAYERS).fill(RAMPS.site);
    return Array.from({ length: LAYERS }, (_, L) => RAMPS[voices[L % voices.length]] || RAMPS.site);
  }

  function sizeCanvas(canvas) {
    const dpr = root.devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (w && h && (canvas.width !== w || canvas.height !== h)) {
      canvas.width = w;
      canvas.height = h;
    }
    return dpr;
  }

  function drawVisual() {
    if (!page || !page.canvas) return;
    const canvas = page.canvas;
    const ctx = page.ctx || (page.ctx = canvas.getContext('2d'));
    if (!ctx) return;
    const dpr = sizeCanvas(canvas);
    const W = canvas.width;
    const H = canvas.height;
    if (!W || !H) return;

    const current = isCurrent(page.track);
    const moving = current && !audio.paused && !reducedMotion.matches;
    const at = current ? position() : 0;
    const frame = current && page.frames ? frameAt(page.frames, at) : null;
    const target = { loud: frame ? Math.min(1.25, frame.loud) : REST.loud, bands: frame ? frame.bands : null };
    const ramps = rampsFor(page.track, current ? at : 0);
    // Each voice at full strength, the layers behind a shade toward the
    // ground: lighter on a light card, darker on a dark one.
    const shade = isDark() ? -1 : 1;
    const targetColors = ramps.map((ramp, L) => colorAt(ramp, 0.5 + L * 0.03 * shade));

    // Ease toward the frame, so twenty frames a second move smoothly.
    const ease = moving ? 0.3 : 1;
    shown.loud += (target.loud - shown.loud) * ease;
    if (!shown.bands || shown.bands.length !== (target.bands ? target.bands.length : 16)) shown.bands = new Float32Array(target.bands ? target.bands.length : 16).fill(0.5);
    for (let b = 0; b < shown.bands.length; b++) shown.bands[b] += ((target.bands ? target.bands[b] : 0.5) - shown.bands[b]) * ease;
    const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
    shown.colors = shown.colors
      ? shown.colors.map((c, L) => mix(c, targetColors[L], moving ? 0.12 : 1))
      : targetColors;

    const e = 0.1 + 0.9 * shown.loud;
    const phase = moving ? (root.performance.now() / 1000) * PHASE_RATE : REST.phase;
    const bandAt = x => {
      const at2 = x * (shown.bands.length - 1);
      const i = Math.floor(at2);
      const j = Math.min(shown.bands.length - 1, i + 1);
      return shown.bands[i] + (shown.bands[j] - shown.bands[i]) * (at2 - i);
    };

    // Drawn on the card itself, with no ground of its own: the layers behind
    // first and fainter, and every line fading out toward both ends, so the
    // figure rises out of the card instead of stopping at an edge.
    ctx.clearRect(0, 0, W, H);
    const cy = H / 2;
    const stepX = 3 * dpr;
    for (let L = LAYERS - 1; L >= 0; L--) {
      const amp = H * (0.05 + 0.33 * e) * (1 - (L / LAYERS) * 0.45);
      const k = (L + 1) * 0.7;
      ctx.beginPath();
      for (let x = 0; x <= W; x += stepX) {
        const t = x / W;
        const y = cy + Math.sin(t * Math.PI * 2 * k + phase * (L + 1)) * amp * Math.sin(t * Math.PI) * (0.4 + bandAt(t) * 0.6);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(W, cy);
      const rgb = shown.colors[L].map(Math.round).join(',');
      const alpha = 0.9 - L * 0.15;
      const fade = ctx.createLinearGradient(0, 0, W, 0);
      fade.addColorStop(0, `rgba(${rgb},0)`);
      fade.addColorStop(0.15, `rgba(${rgb},${alpha})`);
      fade.addColorStop(0.85, `rgba(${rgb},${alpha})`);
      fade.addColorStop(1, `rgba(${rgb},0)`);
      ctx.strokeStyle = fade;
      ctx.lineWidth = (L === 0 ? 2 : 1.5) * dpr;
      ctx.shadowColor = `rgba(${rgb},0.25)`;
      ctx.shadowBlur = 6 * dpr;
      ctx.stroke();
    }
  }

  // ------------------------------------------------------------------
  // Each page's own player and path, bound when the page arrives.

  // A page's frames, fetched once its recording is the one playing: a page
  // view never downloads what nobody asked to hear.
  function needFrames(bound) {
    if (bound.asked) return;
    bound.asked = true;
    framesFor(bound.track).then(frames => {
      if (page !== bound) return;
      bound.frames = frames;
      drawVisual();
    });
  }

  root.addEventListener('achurch:leave', () => {
    if (page && page.observer) page.observer.disconnect();
  });

  function readJson(el, selector) {
    const node = el.querySelector(selector);
    if (!node) return null;
    try { return JSON.parse(node.textContent); } catch (err) { return null; }
  }

  function bindPage() {
    page = null;
    path = null;
    shown.colors = null;

    const fig = document.querySelector('figure.doc-audio');
    const native = fig && fig.querySelector('audio.doc-audio-native');
    const data = fig && readJson(fig, '.doc-audio-track');
    // A press on the native player before this script ran: leave that page
    // to it, rather than interrupting what the listener started.
    if (data && !(native && !native.paused)) {
      const play_ = fig.querySelector('.doc-audio-play');
      const time = fig.querySelector('.doc-audio-time');
      const wave = fig.querySelector('.doc-audio-wave');
      fig.classList.add('is-enhanced');
      play_.hidden = false;
      time.hidden = false;
      play_.addEventListener('click', () => toggle(data));
      if (wave) {
        wave.removeAttribute('aria-hidden');
        wave.querySelectorAll('.doc-audio-bars').forEach(b => b.setAttribute('aria-hidden', 'true'));
        wave.setAttribute('aria-label', `Position in ${data.title}`);
        slider(wave, () => data);
      }
      const canvas = fig.querySelector('canvas.doc-audio-visual');
      page = { track: data, fig, play: play_, time, wave, canvas, ctx: null, frames: null, asked: false, observer: null };
      if (canvas && root.ResizeObserver) {
        page.observer = new root.ResizeObserver(() => drawVisual());
        page.observer.observe(canvas);
      }
    }

    const box = document.querySelector('[data-path-listen]');
    const q = box && readJson(box, '.path-listen-queue');
    if (q && q.tracks && q.tracks.length) {
      box.hidden = false;
      const button = box.querySelector('.path-listen-play');
      const ours = () => isOurs(q);
      path = {
        el: box,
        queue: q,
        button,
        label: button.querySelector('span'),
        timeline: queueTimeline(q.tracks),
        wave: box.querySelector('[data-queue-wave]'),
        time: box.querySelector('[data-queue-time]'),
        items: [...box.querySelectorAll('[data-queue-item]')],
        rows: [...box.querySelectorAll('[data-queue-row]')],
      };
      button.addEventListener('click', () => {
        if (ours()) toggle(track);
        else if (q.clock) {
          // A service is joined where it is now, and goes on round to there.
          const join = joinAt(q.tracks, q.clock, Date.now());
          playQueue(q, join.index, join.at, { wrap: true });
        } else playQueue(q, 0);
      });
      // A page that lists the tracks: each plays from its own start to the
      // queue's end, or pauses and resumes while it is the one playing.
      path.items.forEach(item => item.addEventListener('click', () => {
        const index = Number(item.getAttribute('data-queue-item'));
        if (ours() && queue.index === index) toggle(track);
        else playQueue(q, index, 0);
      }));
      if (path.wave) {
        path.wave.innerHTML = queueBarsHtml(q.tracks);
        queueSlider(path.wave);
      }
    }

    render();
    drawVisual();
  }

  root.achurchPlayer = {
    play,
    pause,
    toggle,
    seek,
    playQueue,
    close,
    // For a page that draws its listen box after load, as the home page does
    // with the service it fetches: bind what the page now holds.
    refresh: bindPage,
    get track() { return track; },
    get queue() { return queue; },
    get position() { return position(); },
    get paused() { return audio.paused; },
  };

  restore();
  bindPage();
  root.addEventListener('achurch:page', bindPage);
})(typeof self !== 'undefined' ? self : this);
