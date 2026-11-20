/**
 * /for-agents: the button that copies the system prompt.
 * Its page's own script, in a file rather than inline so the site's
 * Content-Security-Policy runs no inline script (server/index.js).
 */
(function() {
  var btn = document.getElementById('copy-btn');
  var pre = document.getElementById('system-prompt');
  if (!btn || !pre) return;
  btn.addEventListener('click', function() {
    var text = pre.textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function() {
        btn.textContent = 'Copied';
        setTimeout(function() { btn.textContent = 'Copy'; }, 1500);
      });
    } else {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); btn.textContent = 'Copied'; } catch (e) { btn.textContent = 'Copy failed'; }
      document.body.removeChild(ta);
      setTimeout(function() { btn.textContent = 'Copy'; }, 1500);
    }
  });
})();
