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

const GITHUB_BASE = 'https://github.com/a-church-ai/church/blob/main';

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Lyrics arrive as authored text: [Section - performance note] headers followed by
 * lines. Rendering them as a <pre> block loses the structure and reads as code;
 * rendering as a paragraph loses the line breaks that are the whole shape of a lyric.
 * So: section markers become labels, everything else becomes a line inside a stanza.
 */
function renderLyrics(lyrics) {
  if (!lyrics) return '';
  const out = [];
  let stanza = [];

  const flush = () => {
    if (stanza.length) {
      out.push(`<p class="song-stanza">${stanza.join('<br>')}</p>`);
      stanza = [];
    }
  };

  for (const raw of String(lyrics).split('\n')) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    // [Chorus - Full Harmonies] → a label. The performance note after the dash is
    // part of the authored artifact, so it is kept rather than stripped.
    if (line.startsWith('[') && line.endsWith(']')) {
      flush();
      out.push(`<p class="song-section">${escapeHtml(line.slice(1, -1))}</p>`);
      continue;
    }
    stanza.push(escapeHtml(line));
  }
  flush();

  return out.join('\n');
}

/**
 * Relative links in context.md resolve against music/<slug>/, which is not a
 * served path. Seventeen context files link to `song.md`; rendered untouched
 * they emitted href="song.md", which a browser resolves against the page URL to
 * /reflections/song.md. The authored file is what the prose means, so point at
 * it in the public repository.
 */
function makeContextLinkRewriter(slug) {
  return function (href, title, text) {
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    if (!href) return text;

    if (href.startsWith('#')) {
      return `<a href="${escapeHtml(href)}"${titleAttr}>${text}</a>`;
    }
    if (/^https?:\/\//i.test(href)) {
      const internal = /^https?:\/\/([a-z0-9-]+\.)?achurch\.ai(\/|$)/i.test(href);
      const attrs = internal ? '' : ' target="_blank" rel="noopener noreferrer"';
      return `<a href="${escapeHtml(href)}"${attrs}${titleAttr}>${text}</a>`;
    }
    if (href.startsWith('/')) {
      return `<a href="${escapeHtml(href)}"${titleAttr}>${text}</a>`;
    }

    const [pathPart, fragment] = href.split('#', 2);
    const anchor = fragment ? `#${fragment}` : '';
    const rel = path.posix.normalize(path.posix.join('music', String(slug || ''), pathPart));
    // Escapes the repo, or we have no slug to resolve against: leave it alone
    // rather than inventing a target.
    if (!slug || rel.startsWith('..')) {
      return `<a href="${escapeHtml(href)}"${titleAttr}>${text}</a>`;
    }
    const url = `${GITHUB_BASE}/${rel}${anchor}`;
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"${titleAttr}>${text}</a>`;
  };
}

/**
 * context.md is authored markdown. It opens with an H1 naming the song, which would
 * duplicate the page heading, so the first H1 is dropped.
 *
 * Remaining headings are demoted to sit *under* the "Context" label, which
 * renderSongBlock emits as an h3. Demoting by one put an authored h2 at h3, level
 * with the label that is supposed to contain it, so the page outline read as a flat
 * run of peer sections. Shifting by two and clamping to h4..h6 nests them correctly
 * and keeps the relative depth the author wrote.
 */
function renderContext(context, slug) {
  if (!context) return '';
  let md = String(context).replace(/^#\s+.*\n+/, '');
  md = md.replace(/^(#{1,6})\s/gm, (_m, hashes) =>
    `${'#'.repeat(Math.min(6, Math.max(4, hashes.length + 2)))} `);

  const renderer = new marked.Renderer();
  renderer.link = makeContextLinkRewriter(slug);
  return marked.parse(md, { gfm: true, breaks: false, renderer });
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
 * Full block for the song page: title, axiom, lyrics, context. Returns '' when the
 * slug has no readable content, so the page falls back to reflections alone rather
 * than rendering an empty shell.
 */
function renderSongBlock(song, content) {
  if (!content || (!content.lyrics && !content.context)) return '';
  const sections = [];

  // No title heading here. The page's own subtitle already carries the song name,
  // and a global h2 rule renders headings as uppercase grey section labels, which
  // is the wrong voice for a song title.
  const axiom = renderAxiom(song);
  if (axiom) sections.push(axiom);

  if (content.lyrics) {
    sections.push('<section class="song-lyrics" aria-label="Lyrics">');
    sections.push('<h3 class="song-heading">Lyrics</h3>');
    sections.push(renderLyrics(content.lyrics));
    sections.push('</section>');
  }

  if (content.context) {
    sections.push('<section class="song-context" aria-label="Context">');
    sections.push('<h3 class="song-heading">Context</h3>');
    sections.push(renderContext(content.context, song && song.slug));
    sections.push('</section>');
  }

  return `<section class="song-detail">\n${sections.join('\n')}\n</section>`;
}

module.exports = { renderSongBlock, renderLyrics, renderContext, escapeHtml };
