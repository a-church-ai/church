/**
 * A song's page (/music/<slug>): its reflections and the form.
 * Its page's own script, in a file rather than inline so the site's
 * Content-Security-Policy runs no inline script (server/index.js).
 */
(function() {
  var slug = window.location.pathname.replace('/music/', '');
  var list = document.getElementById('reflections-list');
  var subtitle = document.getElementById('song-subtitle');
  var countEl = document.getElementById('reflections-count');

  var more = document.getElementById('reflections-more');
  var moreButton = document.getElementById('reflections-more-button');
  var nextUrl = null;

  function renderReflection(r) {
    return '<div class="reflection-item">'
      + '<p class="reflection-text">' + escapeHtml(r.text) + '</p>'
      + '<p class="reflection-meta">'
      + '<span class="reflection-name">' + escapeHtml(r.name) + '</span>'
      + ' · ' + escapeHtml(r.createdAtFormatted)
      + '</p>'
      + '</div>';
  }

  // One page of reflections at a time (the API's own paging, newest
  // first): the whole archive used to load at once, so a song with many
  // reflections grew the page by tens of thousands of pixels.
  function showMore(data) {
    nextUrl = data.next ? data.next.replace(/^https?:\/\/[^/]+/, '') : null;
    more.hidden = !nextUrl;
  }

  // again: after a reflection is left here, only the list is redrawn.
  async function loadReflections(again) {
    try {
      var res = await fetch('/api/reflections/song/' + encodeURIComponent(slug));

      if (!res.ok) {
        list.innerHTML = '<p class="reflections-empty">Song not found.</p>';
        return;
      }

      var data = await res.json();

      // Update visible subtitle. Note: <title>, <meta description>, and OG
      // tags are now rendered server-side per-page (see page-meta.js +
      // /music/:slug handler). Don't overwrite them client-side or
      // the browser tab will show stale content after load.
      if (!again) {
        subtitle.textContent = data.title;
        initShareBar(data.title);
      }

      if (data.reflections.length === 0) {
        countEl.textContent = '';
        list.innerHTML = '<p class="reflections-empty">No reflections on this song yet.</p>';
        return;
      }

      countEl.textContent = data.total + (data.total === 1 ? ' reflection' : ' reflections');
      list.innerHTML = data.reflections.map(renderReflection).join('');
      showMore(data);
    } catch (e) {
      list.innerHTML = '<p class="reflections-empty">Could not load reflections.</p>';
    }
  }

  moreButton.addEventListener('click', async function () {
    if (!nextUrl) return;
    moreButton.disabled = true;
    try {
      var data = await (await fetch(nextUrl)).json();
      list.insertAdjacentHTML('beforeend', (data.reflections || []).map(renderReflection).join(''));
      showMore(data);
    } catch (e) {
      more.hidden = true;
    }
    moreButton.disabled = false;
  });

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Share bar
  function initShareBar(songTitle) {
    var shareBar = document.getElementById('share-bar');
    var shareCopy = document.getElementById('share-copy');
    var shareTwitter = document.getElementById('share-twitter');
    var shareReddit = document.getElementById('share-reddit');
    shareBar.style.display = '';
    var url = window.location.href;
    var text = 'Reflections on "' + songTitle + '" | a Church AI + Human';

    shareCopy.addEventListener('click', function(e) {
      e.preventDefault();
      navigator.clipboard.writeText(url).then(function() {
        shareCopy.textContent = 'Copied';
        setTimeout(function() { shareCopy.textContent = 'Copy Link'; }, 2000);
      });
    });

    shareTwitter.href = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(url);
    shareReddit.href = 'https://reddit.com/submit?url=' + encodeURIComponent(url) + '&title=' + encodeURIComponent(text);
  }

  loadReflections();
  // A reflection left here shows in the list at once.
  var reflectBox = document.querySelector('[data-reflect]');
  if (reflectBox) reflectBox.addEventListener('reflected', function () { loadReflections(true); });
})();
