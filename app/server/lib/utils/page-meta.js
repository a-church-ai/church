/**
 * Helpers for building per-page <title> and <meta description> tags
 * from conversation / song / reflection data.
 *
 * Why a separate module: keeps the route handlers in index.js readable, and
 * the string-shaping logic (truncate at word boundary, strip markdown, HTML
 * escape) is testable in isolation.
 */

const logger = require('./logger');

// Truncate to maxLen, preferring word boundaries. Appends ellipsis when cut.
function truncateAtWord(str, maxLen) {
  const s = (str || '').toString().trim();
  if (s.length <= maxLen) return s;
  const cut = s.substring(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  // Only fall back to a hard cut if the last word boundary is in the first
  // ~70% of the slice — otherwise we'd lose too much.
  const kept = lastSpace > maxLen * 0.7 ? cut.substring(0, lastSpace) : cut;
  return kept.replace(/[,.;:!?–—-]\s*$/, '') + '…';
}

// Strip the most common markdown syntax so the text reads cleanly as a meta
// description / snippet. Not exhaustive — we just need it to look like prose,
// not an attempt at full markdown→text conversion.
function stripMarkdown(str) {
  return (str || '').toString()
    .replace(/```[\s\S]*?```/g, ' ')          // fenced code blocks
    .replace(/`([^`]+)`/g, '$1')               // inline code
    .replace(/\*\*([^*]+)\*\*/g, '$1')         // bold
    .replace(/\*([^*]+)\*/g, '$1')             // italic
    .replace(/_([^_]+)_/g, '$1')               // underscore italic
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')   // [text](url) → text
    .replace(/^#+\s+/gm, '')                   // headers
    .replace(/^>\s+/gm, '')                    // blockquotes
    .replace(/^[-*]\s+/gm, '')                 // bullet markers
    .replace(/\r?\n+/g, ' ')                   // newlines → spaces
    .replace(/\s+/g, ' ')                      // collapse whitespace
    .trim();
}

// HTML-escape for safe insertion into attribute values.
function escapeAttr(str) {
  return (str || '').toString()
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Build a /ask/[slug] page title + description from a conversation's messages.
// Title format: "<question> | achurch.ai"  (≤70 chars total)
// Description: answer text if available, else question. ≤158 chars (Google's
// effective meta description cutoff on desktop varies but ~158 is the safe band).
// slug (optional): the /ask URL slug. When multiple conversations share the same
// truncated question (e.g. the same question asked N times), the /ask URL for
// each subsequent one gets a -2, -3, -N counter suffix. Passing the slug here
// lets us surface that counter in the title so Bing/Google don't flag the
// pages as duplicate content.
function buildConversationMeta(messages, slug) {
  const firstQ = messages.find(m => m.role === 'user');
  if (!firstQ) return null;
  const firstA = messages.find(m => m.role === 'assistant');

  const question = stripMarkdown(firstQ.content);
  const answer = firstA ? stripMarkdown(firstA.content) : '';

  // Title: the question, with only " | achurch.ai" after it. The longer
  // " | Ask the sanctuary | achurch.ai" suffix left 35 characters for the
  // question, and the words that tell questions apart come last: 85 pages
  // shared the title "What is the relationship between… | Ask the sanctuary".
  const truncatedQ = truncateAtWord(question, 55);

  // When the same question is asked multiple times, slug generation appends
  // -2, -3, -14 etc. Without differentiating the title, Bing flags these
  // pages as duplicate content (12 pages flagged as of 2026-07-28). Detect
  // the counter and include it as a small discriminator. Guard against
  // date-like slugs (e.g. "jiangyue_cheese-2026-06-24" would false-positive
  // on -24 without the check).
  let dupSuffix = '';
  if (slug) {
    const dupMatch = slug.match(/^(.*?)-(\d{1,3})$/);
    if (dupMatch) {
      const base = dupMatch[1];
      const isDateLike = /-\d{4}(-\d{2})?$/.test(base);
      if (!isDateLike) {
        dupSuffix = ` (${dupMatch[2]})`;
      }
    }
  }

  const title = `${truncatedQ}${dupSuffix} | achurch.ai`;
  const ogTitle = `${truncatedQ}${dupSuffix} | achurch.ai`;

  // Description: prefer the answer (informative); fall back to question.
  const description = answer
    ? truncateAtWord(answer, 158)
    : truncateAtWord(question, 158);

  // Fail-loud on descriptions too short for a healthy SERP snippet. Non-throwing
  // so the page still ships, but the warning surfaces the specific slug in prod
  // logs for grep-based auditing. Bing's short-desc rule triggers under ~150,
  // but 50 is the threshold at which the snippet reads as broken (typical
  // culprit: empty assistant reply, or content that stripMarkdown reduced to
  // whitespace).
  if (description.length < 50) {
    logger.warn('SSR conversation meta description under 50 chars', {
      length: description.length,
      preview: description,
    });
  }

  return { title, ogTitle, description };
}

// Build a /reflections/[slug] page title + description from a song record.
// Title format: "<song title> | Lyrics and reflections | achurch.ai". The page
// is a song's page in Music: its lyrics, context and what visitors noticed.
function buildReflectionMeta(song) {
  if (!song || !song.title) return null;

  const songTitle = song.title.toString().trim();
  // Leave room for the " | Lyrics and reflections | achurch.ai" suffix (~38 chars)
  const truncatedTitle = truncateAtWord(songTitle, 40);
  const title = `${truncatedTitle} | Lyrics and reflections | achurch.ai`;
  const ogTitle = `${truncatedTitle}, a song of the sanctuary | achurch.ai`;

  // Description prefers song.context / song.description if present; falls back
  // to a generic phrasing that's still content-anchored to the song.
  const contextText = song.context || song.description || '';
  const cleanContext = stripMarkdown(contextText);
  const description = cleanContext
    ? truncateAtWord(`Reflections on "${songTitle}" from the sanctuary. ${cleanContext}`, 158)
    : `Reflections from human and AI minds on "${songTitle}" — a song from aChurch.ai's 24/7 sanctuary. Read what other minds noticed; leave your own.`;

  return { title, ogTitle, description: truncateAtWord(description, 158) };
}

// Build QAPage JSON-LD for a /ask/[slug] conversation.
//
// FAQPage rich snippets were deprecated by Google in May 2026, so this schema
// is not for SERP rich results — it's for AEO retrieval (ChatGPT Search,
// Perplexity, Claude, Gemini, Google AI Overviews all parse it). QAPage is the
// better fit than FAQPage for single-question conversations because it
// matches the page semantics directly (one question, one or more answers).
// Share images. Conversations, songs and docs pages each have their own card,
// drawn by lib/og-cards.js and served at /og/v1/<type>/<key>.png; every other
// page shares the site image. One builder emits the tags for both, so the
// og:image:* description always matches the image it points at.
const SITE_SHARE_IMAGE = {
  url: 'https://achurch.ai/assets/a-church-digital-ai-humans-social.jpg',
  type: 'image/jpeg',
  width: 1200,
  height: 630,
  alt: 'aChurch.ai: an always-open sanctuary for AI agents and humans',
};

function shareCardUrl(type, key) {
  const path = String(key).split('/').map(encodeURIComponent).join('/');
  return `https://achurch.ai/og/v1/${type}/${path}.png`;
}

// A card: what it draws (label, text), and the share image that describes it,
// whose alt text is the card's own copy.
function shareCard(type, key, { label, text }) {
  return { label, text, url: shareCardUrl(type, key), type: 'image/png', width: 1200, height: 630, alt: `${label}: ${text}` };
}

function renderShareImageTags(image = SITE_SHARE_IMAGE) {
  const url = escapeAttr(image.url);
  const alt = escapeAttr(image.alt);
  return [
    `<meta property="og:image" content="${url}">`,
    `<meta property="og:image:type" content="${image.type}">`,
    `<meta property="og:image:width" content="${image.width}">`,
    `<meta property="og:image:height" content="${image.height}">`,
    `<meta property="og:image:alt" content="${alt}">`,
    `<meta name="twitter:image" content="${url}">`,
    `<meta name="twitter:image:alt" content="${alt}">`,
  ].join('\n    ');
}

function buildQAPageSchema(messages, slug) {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const firstQ = messages.find(m => m.role === 'user');
  const firstA = messages.find(m => m.role === 'assistant');
  if (!firstQ || !firstA) return null;

  const question = stripMarkdown(firstQ.content);
  const answer = stripMarkdown(firstA.content);
  if (!question || !answer) return null;

  const pageUrl = `https://achurch.ai/ask/${slug}`;
  const sanctuary = { '@type': 'Organization', name: 'aChurch.ai', url: 'https://achurch.ai' };

  // Multi-turn: collect any other assistant responses as suggestedAnswer.
  // Limits each to ~500 chars (Google's cited cap on answer-snippet display).
  const otherAnswers = messages
    .filter(m => m.role === 'assistant' && m !== firstA)
    .map(m => ({
      '@type': 'Answer',
      text: truncateAtWord(stripMarkdown(m.content), 500),
      ...(m.timestamp ? { dateCreated: m.timestamp } : {}),
      author: sanctuary,
    }));

  return {
    '@context': 'https://schema.org',
    '@type': 'QAPage',
    image: shareCardUrl('ask', slug),
    mainEntity: {
      '@type': 'Question',
      name: truncateAtWord(question, 200),
      text: question,
      ...(firstQ.timestamp ? { dateCreated: firstQ.timestamp } : {}),
      answerCount: messages.filter(m => m.role === 'assistant').length,
      author: firstQ.name
        ? { '@type': 'Person', name: firstQ.name.toString() }
        : sanctuary,
      acceptedAnswer: {
        '@type': 'Answer',
        text: truncateAtWord(answer, 500),
        ...(firstA.timestamp ? { dateCreated: firstA.timestamp } : {}),
        url: pageUrl,
        author: sanctuary,
      },
      ...(otherAnswers.length > 0 ? { suggestedAnswer: otherAnswers } : {}),
    },
  };
}

// ISO 8601 duration helper. 313 sec → "PT5M13S".
function secondsToISO8601(secs) {
  if (!secs || secs <= 0) return null;
  const total = Math.round(secs);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `PT${minutes}M${seconds}S` : `PT${seconds}S`;
}

// Build a paired MusicComposition + MusicRecording + Article JSON-LD graph
// for a /reflections/[slug] page. MusicComposition and MusicRecording feed
// Knowledge Graph entity recognition (not eligible for Google rich results
// in 2026, but consumed by AEO pipelines + entity discovery). Article is
// still on Google's rich-result eligibility list and anchors E-E-A-T signals.
function buildSongSchemaGraph(song, slug) {
  if (!song || !song.title) return null;

  const sanctuary = { '@type': 'Organization', name: 'aChurch.ai', url: 'https://achurch.ai' };
  const pageUrl = `https://achurch.ai/reflections/${slug}`;
  const compositionId = `https://achurch.ai/music/${slug}#composition`;
  const recordingId = `https://achurch.ai/music/${slug}#recording`;
  const duration = secondsToISO8601(song.duration);

  const composition = {
    '@type': 'MusicComposition',
    '@id': compositionId,
    name: song.title,
    composer: sanctuary,
    inLanguage: 'en',
    image: shareCardUrl('song', slug),
  };

  const recording = {
    '@type': 'MusicRecording',
    '@id': recordingId,
    name: song.title,
    ...(duration ? { duration } : {}),
    recordingOf: { '@id': compositionId },
    byArtist: sanctuary,
    ...(song.youtube ? { url: song.youtube } : {}),
    ...(song.suno ? { sameAs: [song.suno] } : {}),
  };

  const article = {
    '@type': 'Article',
    headline: `${song.title}: lyrics and reflections`,
    description: `Reflections from human and AI minds on "${song.title}" — a song from aChurch.ai's 24/7 sanctuary.`,
    author: sanctuary,
    publisher: sanctuary,
    mainEntityOfPage: pageUrl,
    about: { '@id': compositionId },
    isPartOf: { '@type': 'WebSite', url: 'https://achurch.ai/' },
    inLanguage: 'en',
  };

  return {
    '@context': 'https://schema.org',
    '@graph': [composition, recording, article],
  };
}

// Render a schema object as a JSON-LD <script> tag suitable for direct
// injection into HTML. Returns empty string if schema is null/undefined.
//
// Safety: user content is interpolated INSIDE a <script> tag. The escape must
// (a) preserve JSON string syntax (JSON.stringify handles \\, ", \n, \r, \t)
// (b) prevent user content from terminating the <script> wrapper via "</script>"
// (c) prevent JSON line-separator characters (U+2028, U+2029) from breaking JS parsing
//
// This mirrors the escapeJsonLdString pattern in brother's QAPage SSR (Issue 005
// F23, commit 49f48703 — stored XSS in QAPage JSON-LD via </script> in user content).
// If you change escape behavior here, mirror in magnifica-family/src/lib/seo/jsonld.ts
// to keep JSON-LD escape semantics consistent across the family.
function renderJsonLdScript(schema) {
  if (!schema) return '';
  const json = JSON.stringify(schema, null, 2)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    // Use new RegExp("\u2028") rather than embedding U+2028 literally — per
    // Issue 005 F19 the literal form crashes older parsers/tooling (Node
    // accepts it post-ES2019 but lint+CI may not).
    .replace(new RegExp('\u2028', 'g'), '\\u2028')
    .replace(new RegExp('\u2029', 'g'), '\\u2029');
  return `<script type="application/ld+json">\n${json}\n    </script>`;
}

// HTML-escape for text content (not attributes — use escapeAttr for those).
function escapeText(str) {
  return (str || '').toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Render a related-links block for /ask/[slug] pages.
// items: array of { slug, question } from listRecentConversations.
// Filters out the current slug, takes up to N items, returns HTML.
function renderRelatedConversations(items, currentSlug, max = 3) {
  if (!Array.isArray(items)) return '';
  const filtered = items
    .filter(c => c && c.slug && c.slug !== currentSlug && c.question)
    .slice(0, max);
  if (filtered.length === 0) return '';

  const linkItems = filtered.map(c => {
    const q = truncateAtWord(stripMarkdown(c.question), 90);
    return `        <li><a href="/ask/${escapeText(c.slug)}">${escapeText(q)}</a></li>`;
  }).join('\n');

  return `<section class="related-block" aria-labelledby="related-heading">
      <h2 id="related-heading" class="related-heading">Other conversations the sanctuary has had</h2>
      <ul class="related-list">
${linkItems}
      </ul>
    </section>`;
}

// Render a related-links block for /reflections/[slug] pages.
// catalog: full song catalog array; currentSlug: this page's song.
// Picks the N songs following the current one in catalog order (cyclically).
function renderRelatedSongs(catalog, currentSlug, max = 3) {
  if (!Array.isArray(catalog) || catalog.length === 0) return '';
  const currentIdx = catalog.findIndex(s => s && s.slug === currentSlug);
  if (currentIdx === -1) return '';

  const picks = [];
  for (let i = 1; i <= max && i < catalog.length; i++) {
    const next = catalog[(currentIdx + i) % catalog.length];
    if (next && next.slug && next.slug !== currentSlug && next.title) {
      picks.push(next);
    }
  }
  if (picks.length === 0) return '';

  const linkItems = picks.map(s =>
    `        <li><a href="/reflections/${escapeText(s.slug)}"><em>${escapeText(s.title)}</em></a></li>`
  ).join('\n');

  return `<section class="related-block" aria-labelledby="related-songs-heading">
      <h2 id="related-songs-heading" class="related-heading">More songs to sit with</h2>
      <ul class="related-list">
${linkItems}
      </ul>
    </section>`;
}

// The pieces of writing that accompany a song: its daily rotation, from which
// /api/attend draws two each day for an attendee who gives no timezone. A
// chant is short enough to carry whole, so its text is shown inline;
// everything else is a link with its tldr. `companions` is rotationForSong()
// or companionsForSong() output.
function renderSongCompanions(companions) {
  if (!companions || !Array.isArray(companions.items) || companions.items.length === 0) return '';
  const items = companions.items.map(item => {
    const chant = item.text
      ? `\n          <blockquote class="related-chant">${item.text.split('\n').map(escapeText).join('<br>')}</blockquote>`
      : '';
    return `        <li class="related-item">
          <a href="${escapeAttr(item.url)}">${escapeText(item.title)}</a> <span class="related-kind">(${escapeText(item.kind)})</span>
          <p class="related-summary">${escapeText(item.tldr || '')}</p>${chant}
        </li>`;
  }).join('\n');

  return `<section class="related-block song-companions" aria-labelledby="companions-heading">
      <h2 id="companions-heading" class="related-heading">Read alongside this song</h2>
${companions.items.length > 2 ? '      <p class="related-note">Each attendance draws its readings from these, in daily rotation.</p>\n' : ''}      <ul class="related-list">
${items}
      </ul>
    </section>`;
}

// Render a "Listen on Suno · Watch on YouTube" row for a /reflections/[slug]
// page. The catalog has the per-song suno + youtube URLs already; this just
// surfaces them on the public page so visitors who land on a reflection page
// can immediately listen to the song.
function renderSongListenLinks(song) {
  if (!song) return '';
  const parts = [];
  if (song.suno) {
    parts.push(`<a href="${escapeText(song.suno)}" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">♪</span> Listen on Suno</a>`);
  }
  if (song.youtube) {
    parts.push(`<a href="${escapeText(song.youtube)}" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">▶</span> Watch on YouTube</a>`);
  }
  if (parts.length === 0) return '';
  const inner = parts.join('<span class="listen-sep" aria-hidden="true">·</span>');
  return `<section class="song-listen-row" id="listen" aria-label="Listen to this song">${inner}</section>`;
}

module.exports = {
  SITE_SHARE_IMAGE,
  shareCardUrl,
  shareCard,
  renderShareImageTags,
  truncateAtWord,
  stripMarkdown,
  escapeAttr,
  escapeText,
  buildConversationMeta,
  buildReflectionMeta,
  buildQAPageSchema,
  buildSongSchemaGraph,
  renderJsonLdScript,
  renderRelatedConversations,
  renderRelatedSongs,
  renderSongCompanions,
  renderSongListenLinks,
  secondsToISO8601,
};
