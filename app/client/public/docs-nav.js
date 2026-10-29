/**
 * Site-wide client-side nav behavior.
 *
 * Loaded on every page: the hand-written pages and the documents share one
 * shell (site-shell.js, docs/render.js). Four responsibilities:
 *   1. The drawer: a modal dialog (site-shell.js renders it empty). Below
 *      768px the menu button opens it with the top bar's places and, on a
 *      section page, the section sidebar; below 1024px a section page's "This
 *      section" button opens the same drawer. Backdrop, close button and
 *      Escape dismiss it; while it is open the rest of the page is inert.
 *   2. The section sidebar's current document, scrolled into view.
 *   3. Right-rail TOC scroll-spy: IntersectionObserver on article h2 elements
 *      updates aria-current="location" on the corresponding TOC link.
 *   4. The top bar's appearance button, which goes round Auto, Light and Dark
 *      (theme.js keeps the choice and sets it before the page paints).
 *
 * No dependencies. Runs after DOMContentLoaded (script is defer-loaded).
 * Each part no-ops when its elements are absent.
 *
 * Pages change in place (site-nav.js), so this runs again on every page of a
 * visit. Its listeners on window and on the media query, and its observer,
 * belong to the page and stop when it is left (window.achurchPage.signal);
 * otherwise each page would add another set.
 */
(function () {
  'use strict';

  const pageSignal = window.achurchPage ? window.achurchPage.signal : undefined;

  const sidebar = document.querySelector('.docs-sidebar');
  const places = document.querySelector('.docs-topbar .topbar-places');
  const drawer = document.querySelector('.docs-drawer');
  const backdrop = document.querySelector('.docs-drawer-backdrop');
  const drawerClose = document.querySelector('.docs-drawer-close');
  const openers = document.querySelectorAll('button[aria-controls="docs-drawer"]');

  // ------ Current document in view ------

  // Only the sidebar's list scrolls (styles.css), so a page deep in a long
  // section would open with its own link below the fold of the list. Scroll
  // the list, not the page, until the current link shows.
  if (sidebar) {
    const list = sidebar.querySelector('.sidebar-list');
    const current = list && list.querySelector('[aria-current="page"]');
    if (current) {
      const listBox = list.getBoundingClientRect();
      const linkBox = current.getBoundingClientRect();
      if (linkBox.bottom > listBox.bottom || linkBox.top < listBox.top) {
        list.scrollTop += linkBox.top - listBox.top - listBox.height / 3;
      }
    }
  }

  // ------ Drawer ------

  if (openers.length && drawer && backdrop) {
    // A way to open the drawer shows below 768px (the menu) or, on a section
    // page, below 1024px ("This section"). Past that width nothing can open
    // it, so an open drawer closes.
    const OPENABLE_MQ = window.matchMedia(sidebar ? '(max-width: 1023px)' : '(max-width: 767px)');
    let previousFocus = null;

    // The server sends the drawer empty and it is filled on first open, so no
    // link is sent twice. Nothing degrades: the drawer needs JS to open at
    // all, so a no-JS visitor was never going to see that second copy.
    function hydrateDrawer() {
      if (drawer.getAttribute('data-hydrated') === 'true') return;
      if (places) drawer.appendChild(places.cloneNode(true));
      if (sidebar) {
        for (let i = 0; i < sidebar.children.length; i++) {
          drawer.appendChild(sidebar.children[i].cloneNode(true));
        }
      }
      drawer.setAttribute('data-hydrated', 'true');
    }

    // Everything on the page but the drawer and its backdrop. While the drawer
    // is open these are inert: nothing behind it can be focused, clicked or
    // read by a screen reader, which is what makes it modal. The browser does
    // this properly; a hand-written focus trap used to, and counted links
    // hidden inside closed <details> while skipping <summary>.
    function pageBehind() {
      return Array.prototype.filter.call(document.body.children, function (el) {
        return el !== drawer && el !== backdrop && el.tagName !== 'SCRIPT';
      });
    }

    function setExpanded(open) {
      openers.forEach(function (b) { b.setAttribute('aria-expanded', String(open)); });
    }

    function openDrawer() {
      hydrateDrawer();
      previousFocus = document.activeElement;
      drawer.classList.add('open');
      backdrop.classList.add('open');
      drawer.setAttribute('aria-hidden', 'false');
      setExpanded(true);
      document.body.classList.add('docs-drawer-open');
      pageBehind().forEach(function (el) { el.inert = true; });
      if (drawerClose) drawerClose.focus();
    }

    function closeDrawer() {
      pageBehind().forEach(function (el) { el.inert = false; });
      drawer.classList.remove('open');
      backdrop.classList.remove('open');
      drawer.setAttribute('aria-hidden', 'true');
      setExpanded(false);
      document.body.classList.remove('docs-drawer-open');
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
    }

    openers.forEach(function (b) { b.addEventListener('click', openDrawer); });
    backdrop.addEventListener('click', closeDrawer);
    if (drawerClose) drawerClose.addEventListener('click', closeDrawer);

    // Close on link tap (drawer's job is done once the user chose a page)
    drawer.addEventListener('click', function (e) {
      const link = e.target.closest && e.target.closest('a[href]');
      if (link && !link.getAttribute('href').startsWith('#')) closeDrawer();
    });

    // Escape to close
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && drawer.classList.contains('open')) closeDrawer();
    }, { signal: pageSignal });

    OPENABLE_MQ.addEventListener('change', function () {
      if (!OPENABLE_MQ.matches && drawer.classList.contains('open')) closeDrawer();
    }, { signal: pageSignal });
  }

  // ------ Appearance ------

  // Applied again on every page, since each new page's head brings the bar
  // colours back to their defaults, and kept in step with the site's other
  // tabs, which share the choice.
  const theme = window.achurchTheme;
  const themeButton = document.querySelector('.topbar-theme');
  const THEME_SAID = { auto: 'Auto, following your device', light: 'Light', dark: 'Dark' };
  if (theme) {
    const storage = theme.storageOf(window);
    let shown = 'auto';
    // choice: the one just made, which stands even where storage is blocked.
    const showTheme = function (choice) {
      shown = choice || theme.stored(storage);
      theme.apply(document, shown);
      if (themeButton) {
        // The icon is the current choice; the name says it, and what a press
        // changes it to.
        const said = 'Appearance: ' + THEME_SAID[shown] + '. Switch to ' + THEME_SAID[theme.next(shown)].split(',')[0] + '.';
        themeButton.setAttribute('data-choice', shown);
        themeButton.setAttribute('aria-label', said);
        themeButton.setAttribute('title', said);
      }
    };
    showTheme(null);
    if (themeButton) {
      themeButton.hidden = false;
      themeButton.addEventListener('click', function () {
        const choice = theme.next(shown);
        theme.choose(document, storage, choice);
        showTheme(choice);
      });
    }
    window.addEventListener('storage', function (e) {
      if (e.key === theme.KEY || e.key === null) showTheme(null);
    }, { signal: pageSignal });
  }

  // ------ Right-rail TOC scroll-spy ------

  const toc = document.querySelector('.docs-toc');
  if (toc && 'IntersectionObserver' in window) {
    const tocLinks = toc.querySelectorAll('a[href^="#"]');
    const linkMap = new Map();
    tocLinks.forEach(function (l) {
      const id = l.getAttribute('href').slice(1);
      if (id) linkMap.set(id, l);
    });
    const headings = document.querySelectorAll('.docs-article h2[id]');

    function setActive(id) {
      tocLinks.forEach(function (l) { l.removeAttribute('aria-current'); });
      const active = linkMap.get(id);
      if (active) active.setAttribute('aria-current', 'location');
    }

    // Trigger when a heading enters the top ~20% of the viewport. The
    // rootMargin skews so we highlight before the heading scrolls past
    // the top, not after.
    const observer = new IntersectionObserver(function (entries) {
      // Find the first entry currently intersecting; use that as active
      const intersecting = entries.filter(function (e) { return e.isIntersecting; });
      if (intersecting.length > 0) {
        // Prefer the last one to intersect (i.e., the section most recently
        // scrolled into the "reading zone")
        setActive(intersecting[intersecting.length - 1].target.id);
      }
    }, {
      rootMargin: '-15% 0px -70% 0px',
      threshold: 0,
    });

    headings.forEach(function (h) { observer.observe(h); });
    if (pageSignal) pageSignal.addEventListener('abort', function () { observer.disconnect(); }, { once: true });
  }
}());
