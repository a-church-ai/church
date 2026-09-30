/**
 * Site-wide client-side nav behavior.
 *
 * Loaded on every page, not just /docs/*: the sanctuary pages share the same
 * shell (sidebar + top bar + drawer) via server/lib/site-shell.js.
 *
 * Three responsibilities:
 *   1. Sidebar collapse/expand state machine: viewport-aware auto-collapse
 *      below 1024px, persisted preference at wider widths, keyboard shortcut.
 *      Pattern borrowed from a sibling project's shipped-in-prod plan.
 *   2. Mobile drawer: a modal dialog (site-shell.js renders it). Hamburger
 *      toggle, backdrop dismissal, Escape; while it is open the rest of the
 *      page is inert. Only relevant below 768px.
 *   3. Right-rail TOC scroll-spy: IntersectionObserver on article h2 elements
 *      updates aria-current="location" on the corresponding TOC link.
 *
 * No dependencies. Runs after DOMContentLoaded (script is defer-loaded).
 * If any expected element is missing, the whole thing no-ops gracefully.
 */
(function () {
  'use strict';

  const NARROW_MQ = window.matchMedia('(max-width: 1023px)');
  const MOBILE_MQ = window.matchMedia('(max-width: 767px)');
  const STORAGE_KEY = 'sidenav.collapsed';

  const sidebar = document.querySelector('.docs-sidebar');
  const drawer = document.querySelector('.docs-drawer');
  const backdrop = document.querySelector('.docs-drawer-backdrop');
  const hamburger = document.querySelector('.docs-hamburger');
  const drawerClose = document.querySelector('.docs-drawer-close');
  const toggle = document.querySelector('.docs-sidebar .docs-sidebar-toggle');

  if (!sidebar) return; // Not a docs page

  // ------ Collapse-state machine ------

  function readPref() {
    try { return window.localStorage.getItem(STORAGE_KEY) === '1'; }
    catch { return false; }
  }
  function writePref(v) {
    try { window.localStorage.setItem(STORAGE_KEY, v ? '1' : '0'); }
    catch { /* private mode or storage disabled */ }
  }

  function apply(collapsed) {
    sidebar.classList.toggle('collapsed', collapsed);
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.setAttribute('aria-label', collapsed ? 'Expand sidebar (Cmd \\)' : 'Collapse sidebar (Cmd \\)');
      toggle.setAttribute('title', collapsed ? 'Expand sidebar (⌘\\)' : 'Collapse sidebar (⌘\\)');
    }
  }

  function recompute() {
    // Auto-collapse always wins at narrow widths; otherwise honor persisted
    // preference (default expanded)
    apply(NARROW_MQ.matches || readPref());
  }

  function toggleCollapsed() {
    const currentlyCollapsed = sidebar.classList.contains('collapsed');
    const next = !currentlyCollapsed;
    if (!NARROW_MQ.matches) {
      // Wide viewport: persist the choice
      writePref(next);
    }
    // At narrow viewports the change is session-only (writePref is skipped
    // so a wider window later gets a fresh default rather than an inherited
    // narrow-window preference)
    apply(next);
  }

  recompute();
  NARROW_MQ.addEventListener('change', recompute);
  if (toggle) toggle.addEventListener('click', toggleCollapsed);

  // Keyboard shortcut: ⌘\ (Mac) / Ctrl+\ (Linux/Windows). Matches
  // Cursor, VS Code, Linear, Vercel. Does not fire when the user is
  // typing in an input/textarea/contenteditable.
  window.addEventListener('keydown', function (e) {
    if (e.key !== '\\') return;
    if (!(e.metaKey || e.ctrlKey)) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    toggleCollapsed();
  });

  // ------ Current page in view ------

  // Only the sidebar's link list scrolls (styles.css), so a page deep in a
  // long category would open with its own link below the fold of the list.
  // Scroll the list, not the page, until the current link shows.
  if (sidebar) {
    const list = sidebar.querySelector('nav');
    const current = list && list.querySelector('[aria-current="page"]');
    if (current) {
      const listBox = list.getBoundingClientRect();
      const linkBox = current.getBoundingClientRect();
      if (linkBox.bottom > listBox.bottom || linkBox.top < listBox.top) {
        list.scrollTop += linkBox.top - listBox.top - listBox.height / 3;
      }
    }
  }

  // ------ Mobile drawer ------

  if (hamburger && drawer && backdrop) {
    let previousFocus = null;

    // The server sends the drawer empty and we clone the sidebar into it on
    // first open. Rendering the same ~39KB nav tree twice per response was
    // three quarters of every page's HTML. Nothing degrades: the hamburger
    // needs JS to open the drawer at all, so a no-JS visitor was never going
    // to see that second copy.
    //
    // The collapse toggle is skipped. It is a desktop control (CSS already
    // hides it inside the drawer) and cloning it would only re-add bytes.
    function hydrateDrawer() {
      if (drawer.getAttribute('data-hydrated') === 'true') return;
      const children = sidebar.children;
      for (let i = 0; i < children.length; i++) {
        if (children[i].classList.contains('docs-sidebar-toggle')) continue;
        drawer.appendChild(children[i].cloneNode(true));
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

    function openDrawer() {
      hydrateDrawer();
      previousFocus = document.activeElement;
      drawer.classList.add('open');
      backdrop.classList.add('open');
      drawer.setAttribute('aria-hidden', 'false');
      hamburger.setAttribute('aria-expanded', 'true');
      document.body.classList.add('docs-drawer-open');
      pageBehind().forEach(function (el) { el.inert = true; });
      if (drawerClose) drawerClose.focus();
    }

    function closeDrawer() {
      pageBehind().forEach(function (el) { el.inert = false; });
      drawer.classList.remove('open');
      backdrop.classList.remove('open');
      drawer.setAttribute('aria-hidden', 'true');
      hamburger.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('docs-drawer-open');
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
    }

    hamburger.addEventListener('click', openDrawer);
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
    });

    // Close drawer automatically when crossing to non-mobile viewport
    MOBILE_MQ.addEventListener('change', function () {
      if (!MOBILE_MQ.matches && drawer.classList.contains('open')) closeDrawer();
    });
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
  }
}());
