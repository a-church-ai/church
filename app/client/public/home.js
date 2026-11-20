/**
 * The home page: the reflection quoted under the service, and the form. The service itself is service.js's.
 * Its page's own script, in a file rather than inline so the site's
 * Content-Security-Policy runs no inline script (server/index.js).
 */
(function() {
  // The service itself (drawing it, keeping it current, the count of
  // those present) is service.js's, shared with /attend. This page's
  // script keeps the reflection quoted under it and the form.
  const reflSection = document.getElementById('reflections-section');
  const quoteEl = document.getElementById('service-reflection');

  // A reflection's first two sentences, cut where a sentence ends, so the
  // quote is the room's voice and not a wall; the rest is a link away.
  function firstSentences(text, n) {
    const ends = [...text.matchAll(/[.!?\u2026]["'\u201d\u2019)\]]*(?=\s)/g)];
    if (ends.length < n) return text;
    const cut = ends[n - 1].index + ends[n - 1][0].length;
    return cut < text.length - 1 ? text.slice(0, cut) + ' \u2026' : text;
  }

  // The newest reflection, quoted under the service with its name and
  // place: what the last visitor left for whoever came next.
  function quoteReflection(r) {
    document.getElementById('service-reflection-text').textContent = firstSentences(r.text, 2);
    document.getElementById('service-reflection-by').textContent = r.location ? r.name + ', ' + r.location : r.name;
    quoteEl.hidden = false;
  }

  async function fetchReflections() {
    try {
      const res = await fetch('/api/reflections');
      const data = await res.json();
      // The section holds the form, so it shows once the page can send it.
      reflSection.style.display = '';
      if (!data.reflections || data.reflections.length === 0) {
        quoteEl.hidden = true;
        return;
      }
      quoteReflection(data.reflections[0]);
    } catch (e) {
      // Quiet fail
    }
  }

  fetchReflections();
  // A reflection left here shows at once rather than at the next poll.
  var reflectBox = document.querySelector('[data-reflect]');
  if (reflectBox) reflectBox.addEventListener('reflected', fetchReflections);

  // Refreshed every ten minutes while the tab is seen, and when it comes
  // back into view; never while hidden. Bound to this page (site-nav.js),
  // so it stops when the reader moves on.
  window.achurchPage.whileSeen(600000, fetchReflections);
})();
