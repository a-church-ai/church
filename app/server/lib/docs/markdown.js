/**
 * The docs as markdown, for agents: the `.md` URLs, `Accept: text/markdown`,
 * MCP read_doc, and /docs/index.md.
 *
 * Served as the raw file, a doc's relative links broke outside the page that
 * rendered them (/docs/rituals.md had 38 of 38 broken), and a category README
 * listed only the pieces someone remembered to add to it. Here every link is
 * made absolute, a README ends with every document actually in its section,
 * and the whole corpus can be listed in one request.
 */

const fs = require('fs').promises;
const discover = require('./discover');
const { extractMeta } = require('./meta');
const { absolutizeLinks, SITE_URL } = require('./links');

async function describe(doc) {
  const markdown = await fs.readFile(doc.fullPath, 'utf8');
  const { title, description } = extractMeta(markdown, doc.urlPath);
  return { title, description, url: `${SITE_URL}/docs/${doc.urlPath}`, urlPath: doc.urlPath, dir: doc.dirRelPath };
}

// Served documents (internal categories excluded), described, optionally filtered.
async function servedDocs(filter = () => true) {
  const docs = (await discover.listAllDocs())
    .filter(d => !discover.isNoindexPath(d.docsRelPath))
    .filter(d => d.stem.toLowerCase() !== 'readme')
    .filter(filter);
  return Promise.all(docs.map(describe));
}

const listLine = d => `- [${d.title}](${d.url})${d.description ? `: ${d.description}` : ''}`;

// A document's markdown with absolute links. A section's README also lists
// every document in that section, so nothing is reachable only by guessing.
async function servedMarkdown(resolved) {
  const markdown = absolutizeLinks(await fs.readFile(resolved.fullPath, 'utf8'), resolved.fullPath);
  const { doc } = resolved;
  if (doc.stem.toLowerCase() !== 'readme' || !doc.dirRelPath) return markdown;
  const inSection = await servedDocs(d => d.dirRelPath === doc.dirRelPath);
  if (!inSection.length) return markdown;
  inSection.sort((a, b) => a.title.localeCompare(b.title));
  return `${markdown.trimEnd()}\n\n## Every document in this section\n\n${inSection.map(listLine).join('\n')}\n`;
}

let indexCache = null;
let indexCacheTime = 0;
const INDEX_TTL = 10 * 60 * 1000;

// Every served document, grouped by section: /docs/index.md.
async function corpusIndex() {
  if (indexCache && Date.now() - indexCacheTime < INDEX_TTL) return indexCache;
  const all = await servedDocs();
  const sections = new Map();
  for (const d of all) {
    const key = d.dir || '';
    if (!sections.has(key)) sections.set(key, []);
    sections.get(key).push(d);
  }
  const lines = [
    '# aChurch.ai: every document',
    '',
    `All ${all.length} documents the site serves, by section. Each is also available as markdown by adding \`.md\` to its URL. Machine-readable overview: ${SITE_URL}/llms.txt`,
  ];
  for (const key of [...sections.keys()].sort()) {
    const docs = sections.get(key).sort((a, b) => a.title.localeCompare(b.title));
    lines.push('', `## ${key || 'Top level'}`, '', ...docs.map(listLine));
  }
  indexCache = lines.join('\n') + '\n';
  indexCacheTime = Date.now();
  return indexCache;
}

module.exports = { servedMarkdown, corpusIndex, servedDocs };
