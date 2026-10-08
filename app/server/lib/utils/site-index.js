/**
 * The site's own pages and its songs, as one search index for /search, beside
 * the Library's documents (/docs/index.json) and the conversations
 * (/conversations/index.json). Those two hold neither, so until 2026-10-07
 * searching "privacy", "podcast" or a song's name found nothing of the site
 * itself. Entries take the indexes' shape, { title, url, description, label },
 * which client/public/site-search.js reads.
 *
 * The Library's sections are here too: the document index lists documents,
 * not the section pages that gather them (each a section's README), so
 * "chants" found every chant but not Chants, where they play in order.
 *
 * The pages are the top bar's and the footer's (site-shell.js), each titled
 * and described as it is for search engines (its <title>, without the site's
 * name, and its meta description), so "songs" finds Music, whose title says
 * what it holds; a song by its title and the description its page gives
 * (music/song-content.js). Read on each request,
 * like the other indexes, so a new song or a reworded page is found at once.
 */

const fs = require('fs').promises;
const path = require('path');
const { PLACES, FOOTER_MORE, FOOTER_LEGAL } = require('../site-shell');
const { loadCatalog } = require('./data');
const { songDescription } = require('../music/song-content');
const { SITE_NAME } = require('./page-meta');
const discover = require('../docs/discover');

const PUBLIC = path.join(__dirname, '../../../client/public');

// The two places the server draws rather than a file, titled and described
// here.
const DRAWN = {
  '/docs': ['The Library', 'Everything the sanctuary has written: philosophy, practice, prayers, rituals, chants, hymns and writing for builders, with reading paths into it.'],
  '/conversations': ['Conversations: every question asked here', 'Every question asked of the sanctuary\'s writing, with its answer, newest first.'],
  '/services': ['Every day\'s services', 'Each day\'s services, every hour and hemisphere, with the reflections visitors left during each.'],
};

const ENTITIES = { amp: '&', quot: '"', '#39': '\'', apos: '\'', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', lt: '<', gt: '>' };
const decode = text => text.replace(/&(#\d+|[a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] || m);

// A page's title, without the site's name its <title> ends with, and its
// description.
async function pageMeta(url) {
  if (DRAWN[url]) return DRAWN[url];
  const file = url === '/' ? 'index.html' : `${url.slice(1)}.html`;
  const html = await fs.readFile(path.join(PUBLIC, file), 'utf8');
  const title = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
  const description = (html.match(/<meta name="description" content="([^"]*)"/i) || [])[1] || '';
  return [decode(title).replace(new RegExp(`\\s+\\|\\s+${SITE_NAME.replace(/[+]/g, '\\+')}\\s*$`), '').trim(), decode(description)];
}

async function sitePages() {
  const places = [...PLACES, ...FOOTER_MORE, ...FOOTER_LEGAL, { url: '/conversations', label: 'Conversations' }, { url: '/services', label: 'Services' }]
    .filter((p, i, all) => p.url.startsWith('/') && all.findIndex(q => q.url === p.url) === i);
  const pages = await Promise.all(places.map(async p => {
    const [title, description] = await pageMeta(p.url);
    return { title: title || p.label, url: p.url, description, label: 'Page' };
  }));
  const sections = (await discover.listSections()).map(c => {
    const readme = discover.docAt(c.name);
    return {
      title: c.title,
      url: `/docs/${c.name}`,
      description: (readme && readme.description) || `${c.title} in the Library`,
      label: 'Section',
    };
  });
  const songs = await Promise.all((await loadCatalog()).map(async s => ({
    title: s.title,
    url: `/reflections/${s.slug}`,
    description: await songDescription(s),
    label: 'Song',
  })));
  return [...pages, ...sections, ...songs];
}

module.exports = { sitePages };
