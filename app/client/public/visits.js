/**
 * What this page reports of its own visit, so the sanctuary can see how its
 * services and pages serve the people who come (lib/insights/visits.js has
 * what is kept and what never is; the owner's decision of 2026-11-01).
 *
 * - A page view, sent when the page is left or hidden, if it stayed in view
 *   three seconds: its path, time in view, how far it was scrolled, which
 *   sections came into view, the section whose link brought the visitor here,
 *   what was used on it, and on a load's first page where the visit came from.
 * - A recording begun or heard to its end, and a service begun, each part
 *   reached and the service heard through, as the player tells them
 *   (site-player.js, achurch:listen).
 * - A visitor id, random, made in this browser and kept a year, so visits on
 *   different days can be counted as one visitor's. Never a name, never
 *   joined to anything written here, never used to change what is shown.
 *   Where the law asks for consent first (the server says so from where the
 *   visitor is), no id is made until "Count me in"; visits still count, joined
 *   to nothing. "Don't count my visits" (the footer, the privacy page) stops
 *   everything and deletes the id.
 *
 * Loaded once per document in <head>, like site-nav.js, so its listeners are
 * the document's, not a page's, and they last the visit by design.
 */
(function (root) {
  'use strict';

  const STAY_MS = 3000;
  const YEAR = 365 * 864e5;
  const FROM_MS = 30 * 60 * 1000;
  const PRESS_MS = 2000;
  const KEY_ID = 'achurch:visitor';               // { id, made }, localStorage
  const KEY_OFF = 'achurch:visits-off';           // '1': the visitor turned counting off
  const KEY_CONSENT = 'achurch:visits-consent';   // 'yes' or 'no', the card's answer
  const KEY_NOTICE = 'achurch:visits-notice';     // 'yes' or 'no', sessionStorage: the server's answer
  const KEY_FROM = 'achurch:visits-from';         // { placement, to, at }, sessionStorage

  // ---- pure, and tested in Node (test/visits.test.js) ----------------------

  const SEARCH = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|brave|yandex|baidu|kagi|startpage|qwant)\./;
  const ASSISTANT = /(^|\.)(chatgpt\.com|chat\.openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com|you\.com|phind\.com|meta\.ai)$/;
  const YOUTUBE = /(^|\.)(youtube\.com|youtu\.be)$/;
  const PODCAST = /(^|\.)(podcasts\.apple\.com|open\.spotify\.com|spotify\.com|overcast\.fm|pocketcasts\.com|castbox\.fm|podcastaddict\.com|player\.fm)$/;
  const SOCIAL = /(^|\.)(bsky\.app|x\.com|t\.co|twitter\.com|facebook\.com|reddit\.com|threads\.net|linkedin\.com|instagram\.com|tiktok\.com|mastodon\.social|lnkd\.in)$/;

  // Where a visit came from: the referring site's kind, or the campaign tag's.
  function sourceOf(referrer, ownHost, utmSource) {
    const tag = String(utmSource || '').toLowerCase();
    if (tag) {
      if (/youtube/.test(tag)) return 'youtube';
      if (/spotify|apple|podcast|overcast|pocket/.test(tag)) return 'podcast';
      if (/chatgpt|openai|perplexity|claude|gemini|copilot/.test(tag)) return 'assistant';
      if (/bsky|bluesky|twitter|^x$|facebook|reddit|mastodon|threads|linkedin|instagram|tiktok/.test(tag)) return 'social';
      if (/google|bing|duckduckgo/.test(tag)) return 'search';
      return 'site';
    }
    let host = '';
    try { host = new URL(referrer).hostname.toLowerCase(); } catch (err) { return 'direct'; }
    if (!host || host === ownHost) return 'direct';
    if (ASSISTANT.test(host)) return 'assistant';
    if (YOUTUBE.test(host)) return 'youtube';
    if (PODCAST.test(host)) return 'podcast';
    if (SOCIAL.test(host)) return 'social';
    if (SEARCH.test(host)) return 'search';
    return 'site';
  }

  function deviceOf(width, touch) {
    if (width < 600) return 'phone';
    if (width < 1100 && touch) return 'tablet';
    return 'desktop';
  }

  function browserOf(ua) {
    ua = String(ua || '');
    if (/Edg\//.test(ua)) return 'edge';
    if (/SamsungBrowser/.test(ua)) return 'samsung';
    if (/Firefox\//.test(ua)) return 'firefox';
    if (/Chrome\//.test(ua)) return 'chrome';
    if (/Safari\//.test(ua)) return 'safari';
    return 'other';
  }

  // Whether an id may be made: never when counting is off; where a notice is
  // needed, only after "Count me in"; elsewhere once the server has answered.
  function mayIdentify({ off, notice, consent }) {
    if (off) return false;
    if (consent === 'yes') return true;
    if (consent === 'no') return false;
    return notice === 'no';
  }

  // The service a queue plays, from its name ("service:<date>:<slot>").
  function serviceOf(queue) {
    const m = queue && /^service:(\d{4}-\d{2}-\d{2}):(.+)$/.exec(queue.name || '');
    return m ? { date: m[1], slot: m[2] } : null;
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = { sourceOf, deviceOf, browserOf, mayIdentify, serviceOf, STAY_MS };
    return;
  }
  if (root.achurchVisits) return;
  const nav = root.navigator || {};
  if (nav.webdriver) { root.achurchVisits = { used() {} }; return; }

  // ---- storage, which may be refused (a private window, blocked site data) ----

  const store = (area) => ({
    get(k) { try { return root[area].getItem(k); } catch (err) { return null; } },
    set(k, v) { try { root[area].setItem(k, v); } catch (err) { /* not kept */ } },
    remove(k) { try { root[area].removeItem(k); } catch (err) { /* nothing to remove */ } },
  });
  const local = store('localStorage');
  const session = store('sessionStorage');
  const readJSON = (s, k) => { try { return JSON.parse(s.get(k) || 'null'); } catch (err) { return null; } };
  const uuid = () => (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));

  const isOff = () => local.get(KEY_OFF) === '1';
  const state = () => ({ off: isOff(), notice: session.get(KEY_NOTICE), consent: local.get(KEY_CONSENT) });

  // The id, made when it may be and replaced a year after it was made. A
  // visitor who is asked and has not said yes keeps none, even one made
  // before (on a visit from elsewhere).
  function visitorId() {
    const st = state();
    if (!mayIdentify(st)) {
      if (st.off || st.notice === 'yes') local.remove(KEY_ID);
      return null;
    }
    let saved = readJSON(local, KEY_ID);
    if (!saved || !saved.id || !(Date.now() - saved.made < YEAR)) {
      saved = { id: uuid(), made: Date.now() };
      local.set(KEY_ID, JSON.stringify(saved));
    }
    return saved.id;
  }

  // ---- sending ---------------------------------------------------------------

  function post(rows, { answer = false } = {}) {
    if (isOff()) return;
    const body = JSON.stringify({ visitor: visitorId(), rows });
    if (!answer && nav.sendBeacon) {
      try { if (nav.sendBeacon('/visit', new Blob([body], { type: 'application/json' }))) return; } catch (err) { /* fall through */ }
    }
    const sent = root.fetch('/visit', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true, credentials: 'same-origin' });
    if (!answer) { sent.catch(() => {}); return; }
    sent.then(r => r.json()).then(a => {
      session.set(KEY_NOTICE, a && a.notice ? 'yes' : 'no');
      card();
    }).catch(() => {});
  }

  // ---- the page view -----------------------------------------------------------

  let firstOfLoad = true;
  let view = null;
  let observer = null;
  let lastPress = null;

  function cameFrom() {
    const from = readJSON(session, KEY_FROM);
    session.remove(KEY_FROM);
    return from && from.to === root.location.pathname && Date.now() - from.at < FROM_MS ? from.placement : null;
  }

  function start() {
    view = {
      id: uuid(), path: root.location.pathname, seen: 0, since: root.document.hidden ? null : Date.now(),
      scroll: 0, shown: new Set(), features: new Set(), placement: cameFrom(), first: firstOfLoad,
    };
    firstOfLoad = false;
    measureScroll();
    if (observer) observer.disconnect();
    if ('IntersectionObserver' in root) {
      observer = new root.IntersectionObserver(entries => {
        for (const e of entries) if (e.isIntersecting && view) view.shown.add(e.target.getAttribute('data-placement'));
      }, { threshold: 0.25 });
      for (const el of root.document.querySelectorAll('[data-placement]')) observer.observe(el);
    }
  }

  function seconds(v) {
    return v.seen + (v.since ? Date.now() - v.since : 0);
  }

  // The view so far; sent again later if the page comes back into view, and
  // the report keeps a view's longest.
  function flush() {
    if (!view || seconds(view) < STAY_MS) return;
    const row = {
      kind: 'page', view: view.id, path: view.path, seconds: Math.round(seconds(view) / 1000), scroll: view.scroll,
      shown: [...view.shown], placement: view.placement, features: [...view.features],
    };
    if (view.first) {
      const params = new URLSearchParams(root.location.search);
      // utm_content (or ref, its other name) is which of the sanctuary's own
      // surfaces the link was on; utm_source who outside sent it.
      const utm = { source: params.get('utm_source'), medium: params.get('utm_medium'), campaign: params.get('utm_campaign'), content: params.get('utm_content') || params.get('ref') };
      let referrer = null;
      try { referrer = root.document.referrer ? new URL(root.document.referrer).hostname : null; } catch (err) { /* none */ }
      Object.assign(row, {
        first: true, source: sourceOf(root.document.referrer, root.location.hostname, utm.source),
        referrer: referrer === root.location.hostname ? null : referrer, utm: utm.source || utm.medium || utm.campaign || utm.content ? utm : null,
        device: deviceOf(root.innerWidth, 'ontouchstart' in root || (nav.maxTouchPoints || 0) > 0), browser: browserOf(nav.userAgent),
      });
    }
    post([row]);
  }

  function measureScroll() {
    if (!view) return;
    const doc = root.document.documentElement;
    const height = Math.max(doc.scrollHeight, 1);
    const reached = Math.min(100, Math.round(((root.scrollY || 0) + root.innerHeight) / height * 100));
    if (reached > view.scroll) view.scroll = reached;
  }

  function used(name) {
    if (view) view.features.add(name);
  }

  // ---- what the player tells -----------------------------------------------------

  root.addEventListener('achurch:listen', (e) => {
    const { event, track, queue, startMs } = e.detail || {};
    if (!track) return;
    const service = serviceOf(queue);
    const viewId = view ? view.id : uuid();
    const rows = [];
    if (event === 'started') {
      const placement = lastPress && Date.now() - lastPress.at < PRESS_MS ? lastPress.placement : null;
      rows.push({ kind: 'listen', view: viewId, event: 'started', piece: track.href || track.file, placement, startMs });
      if (service) {
        if (queue.index === 0) { rows.push({ kind: 'service', view: viewId, event: 'begun', ...service, part: 1, parts: queue.total }); used('begin-service'); }
        else rows.push({ kind: 'service', view: viewId, event: 'part', ...service, part: queue.index + 1, parts: queue.total });
      } else used(queue ? 'play-path' : 'play');
    } else if (event === 'finished') {
      rows.push({ kind: 'listen', view: viewId, event: 'finished', piece: track.href || track.file });
      if (service && queue.index === queue.total - 1) rows.push({ kind: 'service', view: viewId, event: 'finished', ...service, part: queue.total, parts: queue.total });
    }
    if (rows.length) post(rows);
  });

  // ---- clicks, forms ---------------------------------------------------------------

  const placementOf = (el) => {
    const at = el && el.closest ? el.closest('[data-placement]') : null;
    return at ? at.getAttribute('data-placement') : null;
  };

  root.document.addEventListener('click', (e) => {
    const placement = placementOf(e.target);
    if (placement) lastPress = { placement, at: Date.now() };
    const link = e.target.closest && e.target.closest('a[href]');
    if (!link) return;
    let url;
    try { url = new URL(link.href, root.location.href); } catch (err) { return; }
    if (PODCAST.test(url.hostname) || /\/podcasts\/[\w-]+\/feed\.xml$/.test(url.pathname)) used('podcast-link');
    if (url.origin === root.location.origin && placement) session.set(KEY_FROM, JSON.stringify({ placement, to: url.pathname, at: Date.now() }));
  }, true);

  root.document.addEventListener('submit', (e) => {
    const placement = placementOf(e.target);
    if (placement === 'ask') used('ask');
    if (e.target.matches && e.target.matches('[role="search"], form[action="/search"]')) used('search');
  }, true);
  // The reflection form says when a reflection was sent (reflect-form.js);
  // that one was, never what it said.
  root.document.addEventListener('reflected', () => used('reflect-sent'), true);
  root.document.addEventListener('focusin', (e) => { if (placementOf(e.target) === 'reflect') used('reflect-open'); }, true);

  root.addEventListener('scroll', measureScroll, { passive: true });
  root.document.addEventListener('visibilitychange', () => {
    if (!view) return;
    if (root.document.hidden) {
      if (view.since) { view.seen += Date.now() - view.since; view.since = null; }
      flush();
    } else view.since = Date.now();
  });
  root.addEventListener('pagehide', flush);
  root.addEventListener('achurch:leave', () => { flush(); view = null; });
  root.addEventListener('achurch:page', () => { start(); card(); switches(); });

  // ---- the consent card, and the switch ---------------------------------------------

  function card() {
    const existing = root.document.querySelector('.visits-card');
    const st = state();
    if (st.off || st.notice !== 'yes' || st.consent) { if (existing) existing.remove(); return; }
    if (existing || !root.document.body) return;
    const el = root.document.createElement('aside');
    el.className = 'visits-card';
    el.setAttribute('data-persist', '');
    el.setAttribute('data-placement', 'consent');
    el.setAttribute('aria-labelledby', 'visits-card-title');
    el.innerHTML = '<div class="visits-card-text"><h2 id="visits-card-title">Help shape your services</h2>'
      + '<p>Let your visits count, and the services, prayers and meditations that help you most are the ones we make more of. <a href="/privacy#visits">How it works</a></p></div>'
      + '<div class="visits-card-actions"><button type="button" class="visits-yes">Count me in</button><button type="button" class="visits-no">No thanks</button></div>';
    el.querySelector('.visits-yes').addEventListener('click', () => { local.set(KEY_CONSENT, 'yes'); el.remove(); visitorId(); });
    el.querySelector('.visits-no').addEventListener('click', () => { local.set(KEY_CONSENT, 'no'); local.remove(KEY_ID); el.remove(); });
    root.document.body.appendChild(el);
  }

  // Every "Don't count my visits" on the page (the footer's, the privacy
  // page's). Counted is on and, where a visitor is asked, said yes to; the
  // switch also lets an asked visitor who said No thanks change their answer.
  const counted = () => !isOff() && local.get(KEY_CONSENT) !== 'no';
  function switches() {
    for (const b of root.document.querySelectorAll('[data-count-switch]')) {
      b.hidden = false;
      b.textContent = counted() ? "Don't count my visits" : 'Count my visits';
      b.setAttribute('aria-pressed', counted() ? 'false' : 'true');
      if (b.dataset.bound) continue;
      b.dataset.bound = '1';
      b.addEventListener('click', () => {
        if (counted()) { local.set(KEY_OFF, '1'); local.remove(KEY_ID); view = null; }
        else { local.remove(KEY_OFF); local.set(KEY_CONSENT, 'yes'); visitorId(); if (!view) start(); }
        switches();
        card();
      });
    }
  }

  root.achurchVisits = { used };

  function begin() {
    start();
    switches();
    if (isOff()) return;
    // Once a session: ask the server whether this visitor needs the card.
    if (!session.get(KEY_NOTICE)) post([], { answer: true });
    else card();
  }
  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', begin, { once: true });
  else begin();
})(typeof self !== 'undefined' ? self : this);
