/**
 * Search over JSON indexes, in the browser: the library (/docs/index.json)
 * and the conversation archive (/conversations/index.json), each on its own
 * page, and both together on /search.
 *
 * Nothing typed here leaves the page. The index is fetched whole, once, the
 * first time the field is used, and searched locally, so a search is never
 * logged, never counted as presence and never published. That is the
 * difference from Ask, which answers a question and makes it a public page.
 *
 * Markup: a <section class="site-search" data-index="..." data-noun="...">
 * rendered by page-lists.js renderSearchBox, hidden until this script shows it.
 * data-index holds one index or several, separated by spaces; their entries
 * are searched as one list, in that order. A field marked autofocus takes the
 * cursor once the box shows. Index entries: { title, url, description?, label? }.
 *
 * The ranking is a pure function (search) so it can be tested without a
 * browser; test/site-search.test.js requires this file.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else api.attachAll(root.document);
}(typeof self !== 'undefined' ? self : this, function () {
  var MAX_RESULTS = 30;

  // A word's stem, roughly: "ending" and "ends" both find "end", "memories"
  // finds "memory". Enough for a person remembering an idea but not its exact
  // words; short words are left whole so "is" does not become "i".
  function stem(word) {
    if (word.length <= 4) return word;
    return word.replace(/ies$/, 'y').replace(/(ing|ed|es|s)$/, '');
  }

  function terms(query) {
    return String(query || '').toLowerCase().split(/\s+/).filter(Boolean).map(stem);
  }

  // Every term must appear in the title or the description. Entries whose
  // title holds every term rank first, then those matching partly in the
  // title, then description-only matches; within a rank the index's own
  // order is kept.
  function search(entries, query) {
    var words = terms(query);
    if (!words.length) return [];
    var scored = [];
    entries.forEach(function (e, i) {
      var title = String(e.title || '').toLowerCase();
      var text = title + ' ' + String(e.description || '').toLowerCase();
      if (!words.every(function (w) { return text.indexOf(w) !== -1; })) return;
      var inTitle = words.filter(function (w) { return title.indexOf(w) !== -1; }).length;
      var rank = inTitle === words.length ? 0 : inTitle > 0 ? 1 : 2;
      scored.push({ entry: e, rank: rank, i: i });
    });
    scored.sort(function (a, b) { return a.rank - b.rank || a.i - b.i; });
    return scored.map(function (s) { return s.entry; });
  }

  // The indexes a box names in its data-index.
  function indexesOf(value) {
    return String(value || '').split(/\s+/).filter(Boolean);
  }

  function statusText(count, noun, query) {
    if (!terms(query).length) return '';
    if (!count) return 'No ' + noun + ' match.';
    var shown = Math.min(count, MAX_RESULTS);
    return count + (count === 1 ? ' match' : ' matches') + (count > shown ? ', showing the first ' + shown : '') + '.';
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderResult(e) {
    return '<li><a href="' + escapeHtml(e.url) + '">' + escapeHtml(e.title) + '</a>'
      + (e.label ? ' <span class="site-search-label">' + escapeHtml(e.label) + '</span>' : '')
      + (e.description ? '<br><span class="docs-index-summary">' + escapeHtml(e.description) + '</span>' : '')
      + '</li>';
  }

  function attach(box) {
    var input = box.querySelector('input[type="search"]');
    var status = box.querySelector('.site-search-status');
    var results = box.querySelector('.site-search-results');
    var noun = box.getAttribute('data-noun') || 'entries';
    var index = null;
    var loading = null;

    function load() {
      if (!loading) {
        loading = Promise.all(indexesOf(box.getAttribute('data-index')).map(function (url) {
          return fetch(url).then(function (r) { return r.json(); });
        }))
          .then(function (lists) { index = [].concat.apply([], lists); })
          .catch(function () { index = []; status.textContent = 'Search is unavailable right now.'; });
      }
      return loading;
    }

    function run() {
      load().then(function () {
        var found = search(index, input.value);
        status.textContent = statusText(found.length, noun, input.value);
        results.innerHTML = found.slice(0, MAX_RESULTS).map(renderResult).join('');
      });
    }

    box.hidden = false;
    input.addEventListener('focus', load);
    if (input.hasAttribute('autofocus')) input.focus();
    input.addEventListener('input', run);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && input.value) {
        input.value = '';
        run();
      }
    });
  }

  function attachAll(doc) {
    [].slice.call(doc.querySelectorAll('.site-search[data-index]')).forEach(attach);
  }

  return { search: search, statusText: statusText, indexesOf: indexesOf, attachAll: attachAll, MAX_RESULTS: MAX_RESULTS };
}));
