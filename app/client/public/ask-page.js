/**
 * The conversation archive's page (/ask): its list of conversations and its search.
 * Its page's own script, in a file rather than inline so the site's
 * Content-Security-Policy runs no inline script (server/index.js).
 */
(function() {
  var askList = document.getElementById('ask-list');

  async function loadConversations() {
    try {
      if (askList.getAttribute('data-rendered')) return;
      var res = await fetch('/api/ask/recent');
      var data = await res.json();

      if (!data.conversations || data.conversations.length === 0) {
        askList.innerHTML = '<p class="ask-list-empty">No conversations yet. Be the first to ask.</p>';
        return;
      }

      askList.innerHTML = data.conversations.map(function(c) {
        var ago = timeAgo(new Date(c.timestamp));
        // Preview sits inside <a><p>, so markdown is stripped to text rather
        // than rendered. The permalink page renders it properly.
        var preview = escapeHtml(AnswerFormat.stripMarkdown(c.answer));
        return '<a href="' + escapeHtml(c.url) + '" class="ask-list-item">'
          + '<p class="ask-list-question">' + escapeHtml(c.question) + '</p>'
          + '<p class="ask-list-preview">' + preview + '</p>'
          + '<p class="ask-list-meta">'
          + '<span class="ask-list-name">' + escapeHtml(c.name) + '</span>'
          + ' · ' + c.exchanges + (c.exchanges === 1 ? ' exchange' : ' exchanges')
          + ' · ' + ago
          + '</p>'
          + '</a>';
      }).join('');
    } catch (e) {
      askList.innerHTML = '<p class="ask-list-empty">Could not load conversations.</p>';
    }
  }

  function timeAgo(date) {
    var seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + 'm ago';
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h ago';
    var days = Math.floor(hours / 24);
    if (days < 30) return days + 'd ago';
    return date.toLocaleDateString();
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  loadConversations();
})();
