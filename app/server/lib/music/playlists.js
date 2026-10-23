/**
 * The playlists (docs/playlists/<name>.md), each a page of the Library that
 * plays straight through: here, as the Music page and music/readme.md list
 * them, with how many pieces each holds and how long it plays. A playlist is
 * written like a reading path, as links in order (lib/docs/links.js
 * playlistSequence), and its pieces are the catalog's (lib/service/catalog.js
 * loadPlayable), songs among them.
 */

const discover = require('../docs/discover');
const { playlistSequence } = require('../docs/links');
const { loadPlayable } = require('../service/catalog');
const { listeningTime } = require('../audio/markup');

const escape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The Cycle first, as the playlists' own index introduces it, then by title.
async function listPlaylists() {
  const docs = (await discover.listAllDocs()).filter(d => d.category === 'playlists' && d.stem.toLowerCase() !== 'readme');
  const catalog = await loadPlayable();
  return docs.map(d => {
    const name = d.stem.toLowerCase();
    const pieces = (playlistSequence(name) || []).map(id => catalog.get(id)).filter(Boolean);
    return {
      name,
      title: d.title,
      description: d.description || '',
      url: `/docs/${d.urlPath}`,
      count: pieces.length,
      seconds: pieces.reduce((n, p) => n + p.seconds, 0),
      songs: pieces.filter(p => p.kind === 'song').length,
    };
  }).sort((a, b) => (b.name === 'the-cycle') - (a.name === 'the-cycle') || discover.byName(a.title, b.title));
}

// The Music page's list of playlists.
function renderPlaylistList(playlists) {
  return playlists.map(p => `<li><a href="${escape(p.url)}">${escape(p.title)}</a> <span class="listen-count">${p.count} pieces, about ${listeningTime(p.seconds)}</span></li>`).join('\n              ');
}

module.exports = { listPlaylists, renderPlaylistList };
