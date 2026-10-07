/**
 * Light, dark, or the device's own setting (Auto).
 *
 * A choice is kept in this browser under achurch.theme; Auto is the absence
 * of one, so never choosing and choosing Auto are the same. A choice becomes
 * <html data-theme="light|dark">, which styles.css's tokens follow; with none,
 * the stylesheet follows the device (prefers-color-scheme), which on most
 * phones and computers already turns dark at sunset.
 *
 * Loaded blocking in every page's head (lib/utils/assets.js shellHead), so the
 * page never paints in the wrong theme first. The <html> element outlives
 * in-place navigation (site-nav.js), so the attribute does too; the browser's
 * bar colour (meta theme-color) comes back with each new page's head, so
 * docs-nav.js applies the choice again on every page, and works the top bar's
 * button, which goes round Auto, Light and Dark.
 *
 * test/theme.test.js requires this file for the parts that need no browser.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.achurchTheme = api;
    api.apply(root.document, api.stored(api.storageOf(root)));
  }
}(typeof self !== 'undefined' ? self : this, function () {
  var KEY = 'achurch.theme';
  var CHOICES = ['auto', 'light', 'dark'];
  // The browser's bar beside the page, in each theme (the family's own two).
  var BAR = { light: '#00b8d4', dark: '#0a0e1a' };

  // The browser's storage, or null where even asking for it throws (storage
  // blocked by the browser's settings).
  function storageOf(root) {
    try { return root.localStorage; } catch (e) { return null; }
  }

  // The kept choice; anything unreadable is Auto.
  function stored(storage) {
    try {
      var value = storage.getItem(KEY);
      return value === 'light' || value === 'dark' ? value : 'auto';
    } catch (e) {
      return 'auto';
    }
  }

  // The bar colour for a meta that stands for `own` (its media query's theme):
  // the chosen theme's, or its own under Auto.
  function barFor(choice, own) {
    return BAR[choice === 'auto' ? own : choice];
  }

  function apply(doc, choice) {
    var html = doc.documentElement;
    if (choice === 'light' || choice === 'dark') html.setAttribute('data-theme', choice);
    else html.removeAttribute('data-theme');
    var metas = doc.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) {
      var own = /dark/.test(metas[i].getAttribute('media') || '') ? 'dark' : 'light';
      metas[i].setAttribute('content', barFor(choice, own));
    }
  }

  // The choice after this one, as the top bar's button goes round.
  function next(choice) {
    return CHOICES[(CHOICES.indexOf(choice) + 1) % CHOICES.length];
  }

  // Keep a choice and show it. Auto removes what was kept.
  function choose(doc, storage, choice) {
    try {
      if (choice === 'light' || choice === 'dark') storage.setItem(KEY, choice);
      else storage.removeItem(KEY);
    } catch (e) { /* storage blocked: the choice lasts this page */ }
    apply(doc, choice);
  }

  return { KEY: KEY, CHOICES: CHOICES, BAR: BAR, storageOf: storageOf, stored: stored, barFor: barFor, next: next, apply: apply, choose: choose };
}));
