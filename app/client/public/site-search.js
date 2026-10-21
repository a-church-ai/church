/**
 * Search over JSON indexes, in the browser: the library (/docs/index.json)
 * and the conversation archive (/conversations/index.json), each on its own
 * page, and both together on /search.
 *
 * The index is fetched whole, once, the first time the field is used, and
 * searched locally, so titles match as each letter is typed. A box that names
 * an API (data-api: /search's, /api/search) also asks it, a moment after the
 * typing stops, for the writing that matches by its words and its meaning,
 * and lists those after the titles that match exactly. Either way a search is
 * anonymous: never stored, never counted as presence and never published.
 * That is the difference from Ask, which answers a question and makes it a
 * public page. The query stays in the address (?q=), so a search can be shared.
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
  var win = typeof window !== 'undefined' ? window : null;

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

  // The titles that hold every word first, then the writing found by its
  // words and meaning (the API's ranking), then the rest of the title matches;
  // each page once.
  function merge(found, writing, query) {
    var words = terms(query);
    var exact = found.filter(function (e) {
      var title = String(e.title || '').toLowerCase();
      return words.every(function (w) { return title.indexOf(w) !== -1; });
    });
    var seen = {};
    var out = [];
    function add(e) {
      var key = e.url.replace(/^https?:\/\/[^/]+/, '');
      if (seen[key]) return;
      seen[key] = true;
      out.push(e);
    }
    exact.forEach(add);
    writing.forEach(function (r) {
      add({ title: r.title, url: r.url.replace(/^https?:\/\/[^/]+/, ''), description: r.excerpt, label: r.category === 'song' ? 'Song' : 'Writing' });
    });
    found.forEach(add);
    return out;
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

    var api = box.getAttribute('data-api');
    var asked = 0;
    var lastAsked = null;
    var timer = null;

    function show(found, query) {
      status.textContent = statusText(found.length, noun, query);
      results.innerHTML = found.slice(0, MAX_RESULTS).map(renderResult).join('');
    }

    function run() {
      var query = input.value;
      if (win.history && win.location) {
        var url = new URL(win.location.href);
        if (query.trim()) url.searchParams.set('q', query); else url.searchParams.delete('q');
        win.history.replaceState(win.history.state, '', url.pathname + url.search);
      }
      load().then(function () {
        var found = search(index, query);
        show(found, query);
        if (!api) return;
        clearTimeout(timer);
        if (query.trim().length < 3) return;
        // The same words asked again (the field refocused, a key that changes
        // nothing): the answer already shown stands.
        if (lastAsked && lastAsked.query === query.trim()) {
          if (lastAsked.results) show(merge(found, lastAsked.results, query), query);
          return;
        }
        lastAsked = { query: query.trim(), results: null };
        var ask = ++asked;
        timer = setTimeout(function () {
          fetch(api + '?q=' + encodeURIComponent(query.trim()) + '&limit=10')
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (body) {
              if (!body || ask !== asked) return;
              lastAsked.results = body.results || [];
              show(merge(found, lastAsked.results, query), query);
            })
            .catch(function () { /* the titles stand */ });
        }, 350);
      });
    }

    box.hidden = false;
    input.addEventListener('focus', load);
    var given = win.location ? new URL(win.location.href).searchParams.get('q') : '';
    if (given) {
      input.value = given;
      run();
    }
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

  return { search: search, merge: merge, statusText: statusText, indexesOf: indexesOf, attachAll: attachAll, MAX_RESULTS: MAX_RESULTS };
}));
