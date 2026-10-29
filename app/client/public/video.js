/**
 * A page's video (lib/video/on-site.js renderVideo): the poster is a button,
 * and pressing it puts YouTube's player in its place, playing. Nothing comes
 * from YouTube before that. Any recording playing in the site's player is
 * paused, so the two never sound at once.
 *
 * Loaded by the figure itself, so it runs on any page that has one, and again
 * on each page of a visit (site-nav.js); its listener belongs to the page
 * (window.achurchPage.signal).
 */
(function () {
  'use strict';

  const pageSignal = window.achurchPage ? window.achurchPage.signal : undefined;

  document.querySelectorAll('.doc-video-play[data-youtube]:not([data-bound])').forEach(function (button) {
    button.dataset.bound = '';
    button.addEventListener('click', function () {
      const frame = document.createElement('iframe');
      frame.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(button.dataset.youtube) + '?autoplay=1&rel=0&playsinline=1';
      frame.title = button.getAttribute('aria-label').replace(/^Play the (film|video), /, '').replace(/\. It plays from YouTube\.$/, '');
      frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      // The site sends no referrer (helmet's no-referrer), and YouTube refuses
      // a player that says nowhere where it is (error 153). So this one frame
      // tells YouTube the site, never the page, and only once play is pressed.
      frame.referrerPolicy = 'strict-origin';
      frame.className = 'doc-video-frame';
      if (window.achurchPlayer && !window.achurchPlayer.paused) window.achurchPlayer.pause();
      button.replaceWith(frame);
      frame.focus();
    }, { once: true, signal: pageSignal });
  });
}());
