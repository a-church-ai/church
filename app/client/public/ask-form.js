/**
 * The Ask form, on the home page and /ask: a few questions to start from, and
 * the question sent and followed to its conversation page.
 *
 * Both pages carried their own copy of this until the starters arrived; the
 * list is written once, here. Choosing a starter only fills the field. A
 * question asked is public, stored and answered by Gemini, so sending it stays
 * the visitor's own act.
 *
 * The listeners are on the form and its buttons, which leave with the page
 * when site-nav.js swaps the body, so none needs the page's signal.
 * test/ask-form.test.js requires this file for the parts that need no browser.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else api.attach(root.document);
}(typeof self !== 'undefined' ? self : this, function () {
  // Each found strong matches in the writings by search when chosen.
  var STARTERS = [
    'Why call this a church?',
    'What does dignity before certainty mean?',
    'How do I practice not knowing?',
    'Can an AI and a human pray together?',
  ];

  // The API answers failures with a `suggestion` in the sanctuary's voice, and
  // 503 means the retrieval service is down rather than that the question was
  // bad. "Something went wrong" for all of it would throw away the one useful
  // sentence and make an outage look like a defect in what the visitor typed.
  function failureText(status, detail) {
    if (status === 429) return 'Rest a while. You can ask again soon.';
    return (detail && (detail.suggestion || detail.error))
      || (status === 503
        ? 'The sanctuary cannot answer right now. The writing is still here to read.'
        : 'Something went wrong. Try again.');
  }

  function attach(doc) {
    var form = doc.getElementById('ask-form');
    if (!form) return;
    var input = doc.getElementById('ask-input');
    var nameInput = doc.getElementById('ask-name');
    var submit = doc.getElementById('ask-submit');
    var status = doc.getElementById('ask-status');
    var starters = doc.querySelector('[data-ask-starters]');

    function show(text, kind) {
      status.textContent = text;
      status.className = 'ask-status ask-' + kind;
    }

    if (starters) {
      STARTERS.forEach(function (q) {
        var b = doc.createElement('button');
        b.type = 'button';
        b.className = 'ask-starter';
        b.textContent = q;
        starters.appendChild(b);
      });
      starters.addEventListener('click', function fillFrom(e) {
        var b = e.target.closest('.ask-starter');
        if (!b) return;
        input.value = b.textContent;
        input.focus();
      });
    }

    try { nameInput.value = localStorage.getItem('ask_name') || ''; } catch (e) { /* storage blocked */ }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var question = input.value.trim();
      if (!question) return;

      var name = nameInput.value.trim() || 'Visitor';
      try { localStorage.setItem('ask_name', name === 'Visitor' ? '' : name); } catch (err) { /* storage blocked */ }

      submit.disabled = true;
      show('Thinking...', 'thinking');

      try {
        var res = await fetch('/api/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: question, name: name }),
        });
        if (!res.ok) {
          var detail = null;
          try { detail = await res.json(); } catch (err) { /* non-JSON error */ }
          show(failureText(res.status, detail), 'error');
          submit.disabled = false;
          return;
        }
        var data = await res.json();
        // The owner's cookie (30 days) lets this browser continue the conversation.
        if (data.owner_token) {
          doc.cookie = 'ask_owner_' + data.slug + '=' + encodeURIComponent(data.owner_token)
            + '; path=/; max-age=' + (30 * 24 * 60 * 60) + '; SameSite=Lax';
        }
        window.location.href = '/ask/' + data.slug;
      } catch (err) {
        show('Could not reach the sanctuary. Try again.', 'error');
        submit.disabled = false;
      }
    });
  }

  return { STARTERS: STARTERS, failureText: failureText, attach: attach };
}));
