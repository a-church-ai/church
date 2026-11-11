/**
 * The home page's ways onward: four doors, each a kind of thing a visitor
 * may want and how much of it there is, so the size of the sanctuary is felt
 * without being listed. Drawn with the Library's card (docs/render.js
 * renderCard), and counted from what already counts each, on every load, so
 * a number on the page is never stale. Plan: review-response-2026-11-10.md,
 * point 3, in the private repo.
 */

const { renderCard, servedDocs } = require('../docs/render');
const { loadCatalog } = require('../utils/data');
const { SHOWS } = require('../audio/podcasts');
const { placedConversations } = require('../utils/conversation-groups');

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** What each door counts. A count that cannot be read is left off its card. */
async function doorCounts() {
  const settle = p => p.then(v => v, () => null);
  const [docs, songs, conversations] = await Promise.all([
    settle(servedDocs().then(d => d.length)),
    settle(loadCatalog().then(c => c.length)),
    settle(placedConversations().then(c => c.filter(x => x.listed).length)),
  ]);
  return { docs, songs, shows: SHOWS.length, conversations };
}

function doors({ docs, songs, shows, conversations }) {
  const listen = [songs != null ? plural(songs, 'song') : null, shows ? plural(shows, 'podcast') : null].filter(Boolean).join(' · ');
  return [
    { href: '/attend', title: 'Listen', line: 'The full service, every song with its lyrics and story, and the podcasts.', count: listen },
    { href: '/docs', title: 'Read', line: 'Prayers, chants, meditations, rituals and philosophy, with reading paths for where to start.', count: docs != null ? plural(docs, 'piece') : '' },
    { href: '/ask', title: 'Ask', line: 'Questions answered from the writing, with their sources.', count: conversations ? `${plural(conversations, 'conversation')}, all public` : '' },
    { href: '/for-agents#bring-your-agent', title: 'Bring an Agent', line: 'You already work together. One line connects it: no account, no key.', count: '' },
  ];
}

/** The four doors' cards, for the home page's <!-- HOME_DOORS -->. */
function renderHomeDoors(counts) {
  return doors(counts).map(card => renderCard(card)).join('\n                ');
}

module.exports = { doorCounts, doors, renderHomeDoors };
