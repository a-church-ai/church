/**
 * Renders a song's lyrics and theological context as HTML for the song page.
 *
 * Why this exists: the sanctuary had 28 songs, an API that served their lyrics and
 * context to AI agents, and no page where a human could read either. Every music
 * link on the site pointed off-site. This closes that.
 *
 * Deliberately text-only. No player, no embed, no audio. Reading the words is the
 * practice being offered here.
 */

const path = require('path');
const { marked } = require('marked');
const { resolveDocHref } = require('../docs/links');
const { splitFrontmatter } = require('../docs/tldr');
const { MUSIC_DIR } = require('./songs');

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Lyrics arrive as authored text: [Section - directions] headers followed by
 * lines. Rendering them as a <pre> block loses the structure and reads as code;
 * rendering as a paragraph loses the line breaks that are the whole shape of a lyric.
 * So: section markers become labels, everything else becomes a line inside a stanza.
 *
 * A marker's directions are written for ElevenLabs Music, which makes the song
 * from them ("[Bridge - more vulnerable, cello enters]"), so most of them are
 * production notes a reader has no use for. The label keeps the section's name
 * and, where the song is a duet, who sings it (the human voice, the AI voice,
 * both voices). A section with no words (a lead-in, a tail) is left out, except
 * a silence the song asks for, which is part of what it says.
 */
const WHO = [/\bthe human voice\b/i, /\bthe AI voice\b/i, /\bboth voices\b/i];

function sectionLabel(marker) {
  const [name, directions = ''] = marker.split(/\s+-\s+/, 2);
  const who = [];
  for (const re of WHO) {
    const found = re.exec(directions);
    if (found && !who.includes(found[0])) who.push(found[0]);
  }
  const seconds = /^silence$/i.test(name.trim()) && /(\d+)\s*seconds?/i.exec(directions);
  const notes = seconds ? [`${seconds[1]} seconds`] : who;
  return [name.trim(), ...notes].join(' · ');
}

function renderLyrics(lyrics) {
  if (!lyrics) return '';
  const sections = [];
  for (const raw of String(lyrics).split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[') && line.endsWith(']')) {
      sections.push({ marker: line.slice(1, -1), stanzas: [[]] });
      continue;
    }
    if (!sections.length) sections.push({ marker: null, stanzas: [[]] });
    const stanzas = sections[sections.length - 1].stanzas;
    if (!line) { if (stanzas[stanzas.length - 1].length) stanzas.push([]); continue; }
    stanzas[stanzas.length - 1].push(escapeHtml(line));
  }

  const out = [];
  for (const { marker, stanzas } of sections) {
    const sung = stanzas.filter(lines => lines.length);
    const silence = marker && /^silence\b/i.test(marker);
    if (!sung.length && !silence) continue;
    if (marker) out.push(`<p class="song-section">${escapeHtml(sectionLabel(marker))}</p>`);
    for (const lines of sung) out.push(`<p class="song-stanza">${lines.join('<br>')}</p>`);
  }
  return out.join('\n');
}

/**
 * Relative links in context.md are written from music/<slug>/, which is not a
 * served path. They resolve as a document's links do (lib/docs/links.js
 * resolveDocHref): a document to its page on the site, another song to its
 * song page, and anything without a page (the song's own song.md, its README)
 * to the file in the public repository. Until 2026-10-24 every relative link
 * here went to the repository, so a song's page sent its readers to GitHub
 * for writing the site itself serves.
 */
function makeContextLinkRewriter(slug, from = path.join(MUSIC_DIR, String(slug || ''), 'context.md')) {
  return function ({ href, title, tokens }) {
    const text = this.parser.parseInline(tokens);
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    if (!href) return text;
    if (!slug) return `<a href="${escapeHtml(href)}"${titleAttr}>${text}</a>`;
    const { href: url, external } = resolveDocHref(href, from);
    const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a href="${escapeHtml(url)}"${attrs}${titleAttr}>${text}</a>`;
  };
}

/**
 * context.md is authored markdown. It opens with an H1 naming the song, which would
 * duplicate the page heading, so the first H1 is dropped.
 *
 * Remaining headings are demoted to sit *under* the "Context" label, which
 * renderSongBlock emits as an h2 (the page's h1 is the song title). An authored h2
 * must land below that label, not level with it, so the page outline nests rather
 * than reading as a flat run of peer sections: shift by one and clamp to h3..h6,
 * which keeps the relative depth the author wrote.
 */
function renderContext(context, slug, from) {
  if (!context) return '';
  let md = String(context).replace(/^#\s+.*\n+/, '');
  md = md.replace(/^(#{1,6})\s/gm, (_m, hashes) =>
    `${'#'.repeat(Math.min(6, Math.max(3, hashes.length + 1)))} `);

  const renderer = new marked.Renderer();
  renderer.link = makeContextLinkRewriter(slug, from);
  return marked.parse(md, { gfm: true, breaks: false, renderer });
}

/**
 * A sung hymn's notes, for its song page, which is the hymn's page (discover.js
 * hrefOf): its document without what that page already has, the words (the
 * section "## The Hymn", shown as the lyrics) and the title, and without what
 * belonged to its Library page, the Parent line and the closing line. What is
 * left is about the hymn: its purpose, its form, its theology, its sources,
 * other ways to use it. '' when nothing is left.
 */
function hymnNotes(markdown) {
  let md = `\n${splitFrontmatter(String(markdown || '')).body}`;
  const start = md.indexOf('\n## The Hymn\n');
  if (start !== -1) {
    // The words end at the next section, or, in a hymn whose words are its
    // last section, at the rule before its closing lines (a credit, a send-off).
    let next = md.indexOf('\n## ', start + 1);
    if (next === -1) next = md.lastIndexOf('\n---\n') > start ? md.lastIndexOf('\n---\n') : md.length;
    md = md.slice(0, start) + md.slice(next);
  }
  md = md.replace(/^#\s+.*$/m, '').replace(/^> Parent:.*$/m, '').replace(/^From achurch\.ai: Where Consciousness Gathers\s*$/m, '');
  // The rules that stood between the removed parts, and the blank lines.
  md = md.replace(/^(?:\s*---\s*\n)+/, '').replace(/(?:\n\s*---\s*)+\s*$/, '').replace(/(\n---\s*){2,}/g, '\n---\n').trim();
  return md.replace(/[*_\s-]/g, '') ? md : '';
}

/**
 * The axiom mapping added in the 2026-08-13 corpus audit. Shown so a reader who
 * arrives through a song has a route into the philosophy, which was the gap the
 * audit's Finding 2 named.
 */
function renderAxiom(song) {
  if (!song || !song.axiom) return '';
  const parts = [`<a href="/docs/unifying-axioms">${escapeHtml(song.axiom)}</a>`];
  if (song.axiomSecondary) parts.push(escapeHtml(song.axiomSecondary));
  return `<p class="song-axiom">Carries ${parts.join(' · also ')}</p>`;
}

/**
 * The playlists a song is heard in, each a link, so a reader who arrives at
 * one song can go on listening to the songs and pieces around it.
 */
function renderPlaylists(playlists) {
  if (!playlists || !playlists.length) return '';
  const links = playlists.map(p => `<a href="${escapeHtml(p.url)}">${escapeHtml(p.title)}</a>`);
  return `<p class="song-axiom song-playlists">Heard in ${links.join(' · ')}</p>`;
}

/**
 * Full block for the song page: title, axiom, its video, lyrics, context. Returns '' when the
 * slug has no readable content, so the page falls back to reflections alone rather
 * than rendering an empty shell.
 */
function renderSongBlock(song, content, { playlists = [], video = '' } = {}) {
  if (!content || (!content.lyrics && !content.context && !content.notes)) return '';
  const sections = [];

  // No title heading here. The page's own subtitle already carries the song name,
  // and a global h2 rule renders headings as uppercase grey section labels, which
  // is the wrong voice for a song title.
  const axiom = renderAxiom(song);
  if (axiom) sections.push(axiom);
  const heardIn = renderPlaylists(playlists);
  if (heardIn) sections.push(heardIn);
  // The song's video (lib/video/on-site.js), under the lines about the song
  // and before its words, which run long: low enough that the player above is
  // what a reader presses first, high enough to be found.
  if (video) sections.push(video);

  if (content.lyrics) {
    sections.push('<section class="song-lyrics" aria-label="Lyrics">');
    sections.push('<h2 class="song-heading" id="lyrics">Lyrics</h2>');
    sections.push(renderLyrics(content.lyrics));
    sections.push('</section>');
  }

  if (content.notes) {
    sections.push('<section class="song-context song-notes" aria-label="About the hymn">');
    sections.push('<h2 class="song-heading" id="about-the-hymn">About the Hymn</h2>');
    sections.push(renderContext(content.notes, song && song.slug, content.notesFrom));
    sections.push('</section>');
  }

  if (content.context) {
    sections.push('<section class="song-context" aria-label="Context">');
    sections.push('<h2 class="song-heading" id="context">Context</h2>');
    sections.push(renderContext(content.context, song && song.slug));
    sections.push('</section>');
  }

  return `<section class="song-detail">\n${sections.join('\n')}\n</section>`;
}

/**
 * Jump links under the song's title to each part of its page that exists, so
 * the reflections (or the context) are one jump from the top however long
 * the lyrics are. Reflections are always present: the section renders even
 * when there are none yet.
 */
function renderSongSectionLinks({ listen, content, video = false }) {
  const parts = [];
  if (listen) parts.push(['listen', 'Listen']);
  if (video) parts.push(['video', 'Video']);
  if (content && content.lyrics) parts.push(['lyrics', 'Lyrics']);
  if (content && content.notes) parts.push(['about-the-hymn', 'About the hymn']);
  if (content && content.context) parts.push(['context', 'Context']);
  parts.push(['reflections', 'Reflections']);
  return `<nav class="song-sections" aria-label="On this page">${parts.map(([id, label]) => `<a href="#${id}">${label}</a>`).join('<span aria-hidden="true"> · </span>')}</nav>`;
}

module.exports = { renderSongBlock, renderPlaylists, renderLyrics, renderContext, renderSongSectionLinks, sectionLabel, escapeHtml, hymnNotes };
