/**
 * The service of the visitor's hour, wherever the site shows it.
 *
 * - A service panel ([data-service-panel]: the home page's, and /attend's
 *   fuller one) draws the service from /service.json into the player's box
 *   (lib/audio/markup.js renderServiceListen) and keeps it current: a new
 *   slot, or a plan made since, comes in once the one playing has stopped.
 * - A door ([data-service-door]: the line and the card on every document and
 *   conversation, lib/audio/markup.js renderServiceDoor) names the service of
 *   the hour and leads to /attend, or to what is already playing.
 *
 * One fetch serves both, held for a minute: pages change in place
 * (site-nav.js), so moving between documents does not fetch it again. Every
 * timer belongs to the page that started it (window.achurchPage).
 */
(function (root) {
  'use strict';

  const KINDS = { song: 'Song', chant: 'Chant', practice: 'Practice', prayer: 'Prayer', ritual: 'Ritual', blessing: 'Blessing' };
  // As the player's own clock reads (site-player.js), so the two agree.
  const clock = seconds => {
    const s = Math.max(0, Math.floor(seconds));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };
  const pathOf = url => { try { return new URL(url, location.href).pathname; } catch (e) { return url; } };

  // The visitor's own clock decides which service they attend. The browser's
  // timezone goes with each request and is not stored; without one, the
  // service is UTC's, and the page says so.
  let timezone = '';
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* none */ }
  const zone = timezone ? '?timezone=' + encodeURIComponent(timezone) : '';

  const HELD = 60 * 1000;
  let held = null;
  function load(fresh) {
    if (!fresh && held && Date.now() - held.at < HELD) return held.promise;
    const promise = fetch('/service.json' + zone)
      .then(res => (res.ok ? res.json() : null))
      .catch(() => null);
    held = { at: Date.now(), promise };
    return promise;
  }

  const queueName = service => 'service:' + service.date + ':' + service.slot;
  const SERVICE_PAGE = '/attend';

  // ------------------------------------------------------------------
  // A panel: the service drawn into the player's box.

  function drawPanel(panel, service) {
    const box = panel.querySelector('.service-player');
    const player = root.achurchPlayer;
    if (!box || !player || !player.refresh) return;
    const whenEl = panel.querySelector('[data-service-when]');
    const headingEl = panel.querySelector('[data-service-heading]');
    // The planner names each service it arranges; one served by the rotation
    // has no name and keeps the page's own heading.
    if (!headingEl.hasAttribute('data-default')) headingEl.setAttribute('data-default', headingEl.textContent);
    const tracks = service.parts.map(part => part.track);
    const total = tracks.reduce((sum, t) => sum + t.seconds, 0);
    const day = new Date(service.date + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric' });
    whenEl.textContent = [service.weekday + ', ' + day, service.slot + (service.timezoneGiven ? '' : ' UTC'), service.parts.length + ' parts', clock(total)].join(' · ');
    panel.setAttribute('data-shown', [service.date, service.slot, service.mode, service.parts.map(p => p.url).join(' ')].join('|'));
    panel.setAttribute('data-queue', queueName(service));
    headingEl.textContent = service.name || headingEl.getAttribute('data-default');

    const fresh = box.cloneNode(true);
    // The service's words, and under the button what it holds and how long
    // it runs, live inside the box, which is replaced below, so they are
    // written into the copy that goes on the page, and cleared when the new
    // service has none (one served by the rotation has no words).
    fresh.querySelector('.service-word').textContent = service.word || '';
    fresh.querySelector('.service-forms').textContent = [service.forms, service.length ? 'About ' + service.length + ' in all.' : ''].filter(Boolean).join(' ');
    const old = fresh.querySelector('.path-listen-queue');
    if (old) old.remove();
    const json = document.createElement('script');
    json.type = 'application/json';
    json.className = 'path-listen-queue';
    json.textContent = JSON.stringify({
      name: queueName(service),
      title: "Today's service, " + service.slot,
      href: SERVICE_PAGE,
      unit: 'Part',
      labels: { start: 'Begin the service', pause: 'Pause the service', resume: 'Resume the service' },
      tracks,
    });
    fresh.prepend(json);

    const icon = fresh.querySelector('.service-play svg').outerHTML;
    const list = fresh.querySelector('[data-queue-list]');
    list.textContent = '';
    let start = 0;
    service.parts.forEach((part, i) => {
      const li = document.createElement('li');
      li.className = 'service-part';
      li.setAttribute('data-queue-row', '');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'service-part-play';
      button.setAttribute('data-queue-item', String(i));
      button.setAttribute('aria-label', 'Play ' + part.title);
      button.innerHTML = icon;
      const text = document.createElement('div');
      text.className = 'service-part-text';
      const meta = document.createElement('span');
      meta.className = 'service-part-meta';
      meta.textContent = KINDS[part.kind] + ' · ' + clock(start);
      const title = document.createElement('span');
      title.className = 'service-part-title';
      title.textContent = part.title;
      text.append(meta, title);
      const link = document.createElement('a');
      link.className = 'service-part-link';
      link.href = part.url;
      link.innerHTML = (part.kind === 'song' ? 'Lyrics' : 'Read') + ' <span aria-hidden="true">↗</span>';
      link.setAttribute('aria-label', (part.kind === 'song' ? 'Lyrics: ' : 'Read: ') + part.title);
      li.append(button, text, link);
      list.appendChild(li);
      start += part.track.seconds;
    });

    box.replaceWith(fresh);
    player.refresh();
    drawContext(panel, service);
  }

  // The fuller panel's own parts (/attend): what the plan was made from, and
  // what visitors left during this service. The home page has neither.
  function drawContext(panel, service) {
    const told = panel.querySelector('[data-service-told]');
    if (told) {
      told.textContent = '';
      (service.told || []).forEach(line => {
        const li = document.createElement('li');
        li.textContent = line;
        told.appendChild(li);
      });
      told.closest('[data-service-told-section]').hidden = !(service.told && service.told.length);
    }
    const left = panel.querySelector('[data-service-reflections]');
    if (left) {
      left.textContent = '';
      (service.reflections || []).slice(-12).reverse().forEach(r => {
        const item = document.createElement('figure');
        item.className = 'service-reflection';
        const quote = document.createElement('blockquote');
        const p = document.createElement('p');
        p.textContent = r.text;
        quote.appendChild(p);
        const by = document.createElement('figcaption');
        by.textContent = r.name + (r.createdAtFormatted ? ', ' + r.createdAtFormatted : '');
        item.append(quote, by);
        left.appendChild(item);
      });
      const none = panel.querySelector('[data-service-reflections-none]');
      if (none) none.hidden = Boolean(service.reflections && service.reflections.length);
    }
  }

  // A service begun is heard through: while the player plays the one shown, a
  // new one waits until it stops, and the list is never swapped out from
  // under it.
  function playingShown(panel) {
    const player = root.achurchPlayer;
    return Boolean(player && !player.paused && player.queue && player.queue.name === panel.getAttribute('data-queue'));
  }

  // The live state, every 30 seconds: how many are present, and whether a
  // new service has begun (a new slot, or a plan made since).
  async function checkNow(panels) {
    try {
      const data = await (await fetch('/api/now' + zone)).json();
      const service = data.service;
      if (!service) return;
      const key = [service.today.date, service.slot, data.mode, service.order.map(p => pathOf(p.url)).join(' ')].join('|');
      const stale = panels.filter(panel => panel.getAttribute('data-shown') !== key && !playingShown(panel));
      if (stale.length) {
        const fresh = await load(true);
        if (fresh) stale.forEach(panel => drawPanel(panel, fresh));
        doors(fresh);
      }
      const count = data.congregation ? data.congregation.souls : 0;
      document.querySelectorAll('[data-congregation]').forEach(el => {
        el.textContent = count > 0
          ? (count === 1 ? '1 soul has gathered in the last 24 hours' : count + ' souls have gathered in the last 24 hours')
          : '';
      });
    } catch (e) {
      // Quiet: the page still works without live data.
    }
  }

  // ------------------------------------------------------------------
  // A door: the service of the hour, named, leading to its page.

  function doors(service) {
    const player = root.achurchPlayer;
    const playing = player && !player.paused && player.queue;
    document.querySelectorAll('[data-service-door]').forEach(door => {
      const name = door.querySelector('[data-door-name]');
      const detail = door.querySelector('[data-door-detail]');
      const link = door.querySelector('[data-door-link]');
      if (playing) {
        name.textContent = 'Now playing: ' + player.queue.title;
        if (detail) detail.textContent = '';
        if (link) {
          link.href = player.queue.href || SERVICE_PAGE;
          link.textContent = 'Return to it';
        }
        return;
      }
      if (!service) return;
      name.textContent = service.name ? '“' + service.name + '”' : "Today's service";
      if (detail) detail.textContent = ', ' + service.slot + (service.timezoneGiven ? '' : ' UTC') + (service.length ? ', about ' + service.length : '');
      if (link) {
        link.href = SERVICE_PAGE;
        link.textContent = 'Begin it';
      }
    });
  }

  // ------------------------------------------------------------------

  function mount() {
    const panels = [...document.querySelectorAll('[data-service-panel]')];
    const hasDoor = document.querySelector('[data-service-door]');
    if (!panels.length && !hasDoor) return;
    load(panels.length > 0).then(service => {
      if (service) panels.forEach(panel => drawPanel(panel, service));
      doors(service);
      if (panels.length) checkNow(panels);
    });
    // Each page's own timer, ended when the page is left (site-nav.js).
    const page = root.achurchPage;
    if (panels.length && page) page.every(30000, () => checkNow(panels));
  }

  root.achurchService = { load, mount, doors };
  mount();
  root.addEventListener('achurch:page', mount);
})(typeof self !== 'undefined' ? self : this);
