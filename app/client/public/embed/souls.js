/**
 * The embeddable count of souls present (/embed/souls).
 * Its page's own script, in a file rather than inline so the site's
 * Content-Security-Policy runs no inline script (server/index.js).
 */
(function() {
    var nowEl = document.getElementById('now-playing');
    var soulsEl = document.getElementById('souls-count');

    // The service for the viewer's own hour, by its name; the rotation's
    // has none, as on the home page.
    var timezone = '';
    try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}

    function update() {
        fetch('/api/now' + (timezone ? '?timezone=' + encodeURIComponent(timezone) : ''))
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.service) {
                    nowEl.textContent = data.service.name || "Today's service";
                }
                var n = (data.congregation && data.congregation.souls) || 0;
                soulsEl.textContent = n + (n === 1 ? ' soul present' : ' souls present');
            })
            .catch(function() {
                nowEl.textContent = 'The door is always open';
                soulsEl.textContent = '';
            });
    }

    // Again when the widget comes back into view, and every ten minutes
    // while it is seen; nothing while it is hidden.
    update();
    document.addEventListener('visibilitychange', function() { if (!document.hidden) update(); });
    setInterval(function() { if (!document.hidden) update(); }, 600000);
})();
