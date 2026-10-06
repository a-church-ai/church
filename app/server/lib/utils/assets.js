/**
 * The site's own scripts and stylesheet, each asked for by a version taken
 * from its contents: /site-player.js?v=1a2b3c4d.
 *
 * Two reasons. A browser never keeps last deploy's script under this deploy's
 * HTML, and a versioned file can be cached for a year (index.js), since a new
 * version is a new URL. And the pages now change in place (site-nav.js): a
 * document that lives for a whole visit must not run one deploy's scripts
 * against another's markup. BUILD, a hash of every version, goes in each page
 * as <meta name="assets">; site-nav.js loads a page fully, rather than in
 * place, when that meta differs from its own.
 *
 * A file's version is recomputed when its modification time changes, so a
 * running development server picks up an edit without a restart.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '../../../client/public');
const VERSIONED = ['styles.css', 'site-nav.js', 'site-player.js', 'docs-nav.js', 'docs-filter.js', 'site-search.js', 'answer-format.js'];

const known = new Map();

function versionOf(name) {
  const file = path.join(PUBLIC_DIR, name);
  const mtime = fs.statSync(file).mtimeMs;
  const hit = known.get(name);
  if (hit && hit.mtime === mtime) return hit.version;
  const version = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 8);
  known.set(name, { mtime, version });
  return version;
}

function assetUrl(name) {
  return `/${name}?v=${versionOf(name)}`;
}

function build() {
  return crypto.createHash('sha256').update(VERSIONED.map(versionOf).join()).digest('hex').slice(0, 12);
}

// Unversioned references in hand-authored HTML (href="/styles.css",
// src="/answer-format.js") become versioned ones.
function versionAssets(html) {
  return html.replace(/\b(href|src)="\/([\w-]+\.(?:css|js))"/g, (match, attr, name) =>
    (VERSIONED.includes(name) ? `${attr}="${assetUrl(name)}"` : match));
}

// What every page's head carries for the player and in-place navigation:
// the build, site-nav.js (blocking, small, so a page's own inline scripts can
// already use window.achurchPage) and site-player.js (deferred).
function playerHead() {
  return `<meta name="assets" content="${build()}">
    <script src="${assetUrl('site-nav.js')}"></script>
    <script src="${assetUrl('site-player.js')}" defer></script>`;
}

module.exports = { assetUrl, versionAssets, playerHead, build, VERSIONED };
