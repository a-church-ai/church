/**
 * The filter on index pages (/docs and the category READMEs): type, and the
 * entries that do not match are hidden, whole.
 *
 * An "entry" is a link plus whatever describes it. Three shapes appear in
 * this corpus: a table row (hidden as a row, not as a lone link), a bullet
 * (the link's <li>), and a heading followed by a paragraph or two (the
 * heading plus its siblings up to the next heading of the same or higher
 * level). Hiding only the link would leave orphaned descriptions behind.
 *
 * The matching itself is a pure function (matchEntries) so it can be tested
 * without a browser; test/docs-filter.test.js requires this file.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else api.attach(root.document);
}(typeof self !== 'undefined' ? self : this, function () {
  // entries: [{ text }] (already lowercased). Returns which match and how many.
  function matchEntries(entries, query) {
    var q = String(query || '').trim().toLowerCase();
    var hits = entries.map(function (e) { return !q || e.text.indexOf(q) !== -1; });
    var shown = hits.filter(Boolean).length;
    return { hits: hits, shown: shown, total: entries.length, filtering: q.length > 0 };
  }

  function countLabel(result) {
    if (!result.filtering) return '';
    return result.shown + ' of ' + result.total + (result.total === 1 ? ' entry' : ' entries');
  }

  function groupFor(a) {
    var tr = a.closest('tr');
    if (tr) return [tr];
    var li = a.closest('li');
    if (li) return [li];
    var h = a.closest('h2, h3, h4, h5');
    if (h) {
      var level = Number(h.tagName.slice(1));
      var nodes = [h];
      var n = h.nextElementSibling;
      while (n) {
        var m = /^H([2-5])$/.exec(n.tagName);
        if (m && Number(m[1]) <= level) break;
        nodes.push(n);
        n = n.nextElementSibling;
      }
      return nodes;
    }
    var p = a.closest('p');
    return p ? [p] : [a];
  }

  function attach(doc) {
    var wrap = doc.querySelector('.docs-index-filter');
    var input = doc.getElementById('docs-filter');
    var empty = doc.getElementById('docs-filter-empty');
    var count = doc.getElementById('docs-filter-count');
    // A section page lists its entries in .docs-entries, with the README's
    // essay closed below; only the entries are filtered.
    var article = doc.querySelector('.docs-entries') || doc.querySelector('.docs-content');
    if (!wrap || !input || !article) return;

    // One entry per group: a row or section holding several links is one entry.
    var seen = [];
    var entries = [];
    [].slice.call(article.querySelectorAll('a[href^="/docs/"]')).forEach(function (a) {
      var nodes = groupFor(a);
      if (seen.indexOf(nodes[0]) !== -1) return;
      seen.push(nodes[0]);
      entries.push({
        nodes: nodes,
        text: nodes.map(function (n) { return n.textContent; }).join(' ').toLowerCase(),
      });
    });

    function apply() {
      var result = matchEntries(entries, input.value);
      entries.forEach(function (e, i) {
        e.nodes.forEach(function (n) { n.hidden = !result.hits[i]; });
      });
      empty.hidden = result.shown !== 0;
      if (count) count.textContent = result.shown ? countLabel(result) : '';
    }

    wrap.hidden = false;
    input.addEventListener('input', apply);
    // Escape clears the field and shows everything again; focus stays here.
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && input.value) {
        input.value = '';
        apply();
      }
    });
  }

  return { matchEntries: matchEntries, countLabel: countLabel, attach: attach };
}));
