/**
 * Changing pages without unloading the document, so the site player keeps
 * playing (site-player.js). church-private/docs/plans/audio-player-2026-10-05.md
 * has the plan.
 *
 * A browser stops a media element when its document stops being active, so a
 * recording can only keep playing across pages if the document never changes.
 * Through the Navigation API, a link to another page of the site is fetched
 * and swapped into this document: <body> is replaced except what is marked
 * data-persist (the player), the page-level parts of <head> are merged, and
 * the new page's scripts run. The browser keeps the history entry, back and
 * forward, scroll restoration and the loading indicator.
 *
 * Anything this cannot do safely becomes an ordinary full load: a response
 * that is not HTML, a page from another deploy (<meta name="assets"> differs,
 * lib/utils/assets.js), a page that opts out (<meta name="soft-navigation"
 * content="off">), or any error. A browser without the Navigation API loads
 * every page fully, as before.
 *
 * Every page also gets a lifecycle, window.achurchPage, with an AbortSignal
 * that is aborted when the page is left. In a document that lasts a whole
 * visit, a page script that adds a listener to window or document, or starts
 * a timer, must bind it to that signal, or it keeps running on every later
 * page, and each return adds another. The home page's 30-second polls count
 * toward presence (lib/utils/presence.js), so that would count readers as
 * present on pages they had left.
 *
 * Loaded blocking in <head> on every page, before any page script: it must
 * run once per document and be in place for a page's inline scripts.
 */
(function (root) {
  'use strict';

  // Paths that are not pages: files, APIs, feeds, admin and embeds load as
  // they always have.
  const NOT_PAGES = /^\/(?:api|audio|og|admin|mcp|feed|media|thumbnails|embed|\.well-known)(?:\/|$)/;

  // Whether a URL is a page of this site that can be loaded in place.
  function isSoftNavigable(url, origin) {
    const u = new URL(url, origin);
    if (u.origin !== origin) return false;
    if (NOT_PAGES.test(u.pathname)) return false;
    const last = u.pathname.split('/').pop();
    return !/\.[a-z0-9]+$/i.test(last) || /\.html?$/i.test(last);
  }

  // A page's lifecycle: a signal for its listeners, and timers that stop
  // when it is left.
  function createPage(timers) {
    const controller = new AbortController();
    const signal = controller.signal;
    return {
      signal,
      every(ms, fn) {
        const id = timers.setInterval(fn, ms);
        signal.addEventListener('abort', () => timers.clearInterval(id), { once: true });
        return id;
      },
      leave() {
        controller.abort();
      },
    };
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = { isSoftNavigable, createPage, NOT_PAGES };
    return;
  }

  if (root.achurchNav) return;

  let page = createPage(root);
  root.achurchPage = page;

  const nav = root.navigation;
  const supported = !!(nav && root.NavigateEvent && 'intercept' in root.NavigateEvent.prototype);
  root.achurchNav = { supported };
  if (!supported) return;

  const metaContent = (doc, name) => {
    const el = doc.querySelector(`meta[name="${name}"]`);
    return el ? el.getAttribute('content') : null;
  };

  // A polite live region outside what is swapped, to say which page arrived.
  let status = null;
  function announce(text) {
    if (!status) {
      status = document.createElement('div');
      status.className = 'visually-hidden';
      status.setAttribute('aria-live', 'polite');
      status.setAttribute('data-persist', '');
      document.body.appendChild(status);
    }
    status.textContent = '';
    setTimeout(() => { status.textContent = text; }, 50);
  }

  function fullLoad() {
    // The URL is already committed, so a reload loads the new page fully.
    location.reload();
  }

  function isScript(el) {
    return el.tagName === 'SCRIPT' && (!el.type || /^(text|application)\/javascript$|^module$/i.test(el.type));
  }

  function freshScript(old) {
    const s = document.createElement('script');
    for (const attr of old.attributes) s.setAttribute(attr.name, attr.value);
    if (!old.src) s.textContent = old.textContent;
    s.async = false;
    return s;
  }

  // Keep what both heads share (the stylesheet, these scripts, the build);
  // remove what only the old page had; add what only the new one has, waiting
  // for any new stylesheet so the page never shows unstyled.
  async function mergeHead(next) {
    const have = new Map([...document.head.children].map(el => [el.outerHTML, el]));
    const want = [...next.head.children];
    const wanted = new Set(want.map(el => el.outerHTML));
    for (const [html, el] of have) if (!wanted.has(html)) el.remove();
    const loading = [];
    for (const el of want) {
      if (have.has(el.outerHTML)) continue;
      const node = isScript(el) ? freshScript(el) : document.importNode(el, true);
      if (node.tagName === 'LINK' && node.rel === 'stylesheet') {
        loading.push(new Promise(resolve => { node.onload = node.onerror = resolve; }));
      }
      document.head.appendChild(node);
    }
    await Promise.all(loading);
  }

  function swapBody(next) {
    const kept = [...document.body.children].filter(el => el.hasAttribute('data-persist'));
    for (const attr of [...document.body.attributes]) document.body.removeAttribute(attr.name);
    for (const attr of next.body.attributes) document.body.setAttribute(attr.name, attr.value);
    document.body.replaceChildren(...[...next.body.childNodes].map(n => document.adoptNode(n)), ...kept);
  }

  // A parsed page's scripts are inert; each is replaced by a fresh copy, in
  // order, waiting for each external one, as a full load would run them.
  async function runScripts() {
    for (const old of [...document.body.querySelectorAll('script')]) {
      if (!isScript(old) || old.closest('[data-persist]')) continue;
      const fresh = freshScript(old);
      if (fresh.src) {
        await new Promise(resolve => {
          fresh.onload = fresh.onerror = resolve;
          old.replaceWith(fresh);
        });
      } else {
        old.replaceWith(fresh);
      }
    }
  }

  function focusArrival() {
    const heading = document.querySelector('#content h1, main h1, h1');
    const target = heading || document.querySelector('#content, main');
    if (!target) return;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }

  async function arrive(url, event) {
    let response;
    try {
      response = await fetch(url.href, { headers: { Accept: 'text/html' }, credentials: 'same-origin', signal: event.signal });
    } catch (err) {
      if (event.signal.aborted) return;
      return fullLoad();
    }
    // A redirect (/music/<slug> to /reflections/<slug>) is followed as its
    // own navigation, so the address bar shows where the page really lives.
    // Not history.replaceState: that fires this listener too.
    if (response.redirected) {
      nav.navigate(response.url, { history: 'replace' });
      return;
    }
    if (!/text\/html/.test(response.headers.get('content-type') || '')) return fullLoad();
    const html = await response.text();
    if (event.signal.aborted) return;
    const next = new DOMParser().parseFromString(html, 'text/html');
    if (metaContent(next, 'assets') !== metaContent(document, 'assets')) return fullLoad();
    if (metaContent(next, 'soft-navigation') === 'off') return fullLoad();

    try {
      root.dispatchEvent(new Event('achurch:leave'));
      page.leave();
      page = createPage(root);
      root.achurchPage = page;
      await mergeHead(next);
      swapBody(next);
      await runScripts();
      root.dispatchEvent(new Event('achurch:page'));
    } catch (err) {
      console.error('[site-nav] loading the page in place failed; loading it fully', err);
      return fullLoad();
    }
    event.scroll();
    focusArrival();
    announce(document.title);
  }

  nav.addEventListener('navigate', event => {
    if (!event.canIntercept || event.hashChange || event.downloadRequest || event.formData) return;
    if (event.navigationType === 'reload') return;
    const url = new URL(event.destination.url);
    if (!isSoftNavigable(url, location.origin)) return;
    event.intercept({ scroll: 'manual', focusReset: 'manual', handler: () => arrive(url, event) });
  });
})(typeof self !== 'undefined' ? self : this);
