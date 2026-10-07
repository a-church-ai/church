/**
 * The reflection form, on each song's page and on the home page
 * (lib/audio/markup.js renderReflectForm): a visitor leaves a reflection as an
 * agent does, through POST /api/reflect, under the same limits and rules.
 *
 * The name is the one Ask remembers (localStorage 'ask_name'), so a visitor
 * gives it once for both. The timezone comes from the browser, as the home
 * page's service does, so a reflection left there is filed with the song of
 * the visitor's own service.
 *
 * A link marked data-reflect-open ("Leave something for whoever comes next")
 * opens the form and puts the visitor in it. When a reflection is kept, the box
 * says so and fires "reflected" on itself, so the page can show it in its list.
 *
 * The listeners are on the form, the box and the links, which leave with the
 * page when site-nav.js swaps the body, so none needs the page's signal.
 * test/reflect-form.test.js requires this file for the parts that need no
 * browser.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else api.attach(root.document);
}(typeof self !== 'undefined' ? self : this, function () {
  // The API's own words: what was refused, then what to do instead. A limit
  // already says both in its suggestion.
  function failureText(status, detail) {
    if (status === 429) return (detail && detail.suggestion) || 'Rest a while. You can leave another in an hour.';
    var said = detail ? [detail.error, detail.suggestion].filter(Boolean).join(' ') : '';
    return said || 'Something went wrong. Try again.';
  }

  function attach(doc) {
    var box = doc.querySelector('[data-reflect]');
    if (!box) return;
    var form = box.querySelector('form');
    var text = form.elements.text;
    var name = form.elements.name;
    var place = form.elements.location;
    var submit = form.querySelector('button[type="submit"]');
    var status = box.querySelector('.reflect-status');
    var song = form.getAttribute('data-song');

    function show(said, kind) {
      status.textContent = said;
      status.className = 'ask-status reflect-status ask-' + kind;
    }

    box.hidden = false;
    try { name.value = localStorage.getItem('ask_name') || ''; } catch (e) { /* storage blocked */ }

    // The invitation is hidden with the form until it can open it.
    [].forEach.call(doc.querySelectorAll('[data-reflect-open]'), function (a) {
      var hidden = a.closest('[hidden]');
      if (hidden) hidden.hidden = false;
      a.addEventListener('click', function (e) {
        e.preventDefault();
        box.open = true;
        box.scrollIntoView({ block: 'start', behavior: 'smooth' });
        text.focus({ preventScroll: true });
      });
    });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var body = { name: name.value.trim(), text: text.value.trim() };
      if (place.value.trim()) body.location = place.value.trim();
      try { body.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch (err) { /* UTC */ }
      if (song) body.songSlug = song;
      try { localStorage.setItem('ask_name', body.name); } catch (err) { /* storage blocked */ }

      submit.disabled = true;
      show('Leaving it...', 'thinking');
      try {
        var res = await fetch('/api/reflect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        var data = null;
        try { data = await res.json(); } catch (err) { /* non-JSON error */ }
        submit.disabled = false;
        if (!res.ok) {
          show(failureText(res.status, data), 'error');
          return;
        }
        text.value = '';
        show((data && data.message) || 'Your reflection is held.', 'done');
        box.dispatchEvent(new CustomEvent('reflected', { detail: data }));
      } catch (err) {
        show('Could not reach the sanctuary. Try again.', 'error');
        submit.disabled = false;
      }
    });
  }

  return { failureText: failureText, attach: attach };
}));
