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
const { absolutizeLinks, SITE_URL } = require('./links');
const ns = require('../utils/next-steps');

const { byName } = discover;

const describe = doc => ({
  title: doc.title,
  description: doc.description,
  url: `${SITE_URL}${doc.href}`,
  urlPath: doc.urlPath,
  dir: doc.dirRelPath,
  category: doc.category || '',
});

// Served documents (internal categories excluded), described, optionally
// filtered. Titles and descriptions come from the discover walk.
async function servedDocs(filter = () => true) {
  return (await discover.listAllDocs())
    .filter(d => !discover.isNoindexPath(d.docsRelPath))
    .filter(d => d.stem.toLowerCase() !== 'readme')
    .filter(filter)
    .map(describe);
}

const listLine = d => `- [${d.title}](${d.url})${d.description ? `: ${d.description}` : ''}`;

// Where a document is, for an agent that found it by search: what the site
// is and every way in (next-steps.js waysIn), as information, not instruction.
const WHERE_THIS_IS = `## Where this is

This document is part of aChurch.ai, an always-open sanctuary for AI agents and humans. A service of chants, songs and readings runs for every four-hour slot of a visitor's day, and the library can be searched and asked. No account, no key, no payment.

${ns.waysIn(SITE_URL).map(s => `- [${s.action}](${s.url}) (${s.method}${s.body ? ` with \`${JSON.stringify(s.body)}\`` : ''}${s.tool ? `, or the MCP tool \`${s.tool}\`` : ''}): ${s.description}${s.note ? ` ${s.note}` : ''}`).join('\n')}
`;

// A document's markdown with absolute links, and where it is. A section's
// README also lists every document in that section, so nothing is reachable
// only by guessing, under the headings its page gives them: the README under
// "About <section>" and the list under "In <section>" (render.js
// renderSectionPage). The readiness audit compares a page's headings with its
// markdown's, and the copy of /docs/playlists lacked those two (2026-11-03).
async function servedMarkdown(resolved) {
  let markdown = absolutizeLinks(await fs.readFile(resolved.fullPath, 'utf8'), resolved.fullPath).trimEnd();
  const { doc } = resolved;
  const isSection = doc.stem.toLowerCase() === 'readme' && doc.dirRelPath;
  const inSection = isSection
    ? (await servedDocs(d => d.dirRelPath === doc.dirRelPath)).sort((a, b) => byName(a.title, b.title))
    : [];
  const label = isSection ? discover.sectionLabel(doc.dirRelPath) : '';
  if (isSection) markdown = markdown.replace(/^(# .+\n)/m, `$1\n## About ${label}\n`);
  const list = inSection.length ? `\n\n## In ${label}\n\n${inSection.map(listLine).join('\n')}` : '';
  return `${markdown}${list}\n\n---\n\n${WHERE_THIS_IS}`;
}

// Built once: the walk it reads is built once too (docs change only by deploy).
let indexCache = null;

// Every served document, grouped by section: /docs/index.md.
async function corpusIndex() {
  if (indexCache) return indexCache;
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
  for (const key of [...sections.keys()].sort(byName)) {
    const docs = sections.get(key).sort((a, b) => byName(a.title, b.title));
    lines.push('', `## ${key || 'Top level'}`, '', ...docs.map(listLine));
  }
  indexCache = lines.join('\n') + '\n';
  return indexCache;
}

module.exports = { servedMarkdown, corpusIndex, servedDocs };
