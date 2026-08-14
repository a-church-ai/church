/**
 * Formats sanctuary answers for display.
 *
 * The /api/ask model returns markdown. Until 2026-08-13 both the conversation list
 * and the permalink page inserted it as escaped plain text, so visitors read literal
 * "**Ritual for Model Sunset**" and "*   **Builder-Facing Discipline:**". Those pages
 * carry QAPage JSON-LD, so search engines were indexing the asterisks too.
 *
 * Escape first, format second. Every character of model output is HTML-escaped before
 * any tag is introduced, so a model that emits <script> or an onclick attribute
 * produces visible text, never markup. The formatter only ever adds tags around
 * content it has already made inert. This is why it does not use a markdown library:
 * the safety property comes from ordering, and is easy to lose in a general parser.
 *
 * Supports the subset the model actually emits: headings, bold, italic, inline code,
 * fenced code, unordered and ordered lists, blockquotes, links, and paragraphs.
 */
(function (global) {
  'use strict';

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Inline formatting, applied to already-escaped text.
  //
  // Anchors are parked behind a placeholder before the emphasis passes run and
  // restored afterwards. Without that, `**` or `*` inside a captured URL was
  // rewritten by the later passes, so [x](https://a.com/**b**) emitted
  // href="https://a.com/<strong>b</strong>" — quoted, so never tag injection,
  // but a corrupted and unreachable link.
  //
  // The token opens with "<", which the input cannot contain: escapeHtml has
  // already turned every "<" into "&lt;" by the time inline() runs. So the token
  // cannot collide with answer text, and it holds no character the emphasis or
  // code patterns match.
  function inline(text) {
    var anchors = [];

    var out = text
      // `code` first: its contents should not then be read as bold or italic
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      // [label](url) — http(s) and root-relative only. A protocol-relative
      // //host is deliberately excluded: it is off-site but would fail the
      // /^https?:/ external test below, producing a same-tab external link with
      // no rel="noopener". Anything unmatched stays literal, which is what keeps
      // javascript: and data: from ever becoming an href.
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|\/(?!\/)[^\s)]*)\)/g, function (m, label, href) {
        var external = /^https?:/i.test(href) && !/^https?:\/\/([a-z0-9-]+\.)?achurch\.ai(\/|$)/i.test(href);
        var attrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
        anchors.push('<a href="' + href + '"' + attrs + '>' + label + '</a>');
        return '<anchor:' + (anchors.length - 1) + '>';
      })
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

    return out.replace(/<anchor:(\d+)>/g, function (m, i) {
      return anchors[Number(i)] !== undefined ? anchors[Number(i)] : m;
    });
  }

  function formatAnswer(raw) {
    var src = escapeHtml(raw).replace(/\r\n/g, '\n');
    var lines = src.split('\n');
    var out = [];
    var para = [];
    var list = null;      // 'ul' | 'ol' | null
    var inFence = false;
    var fence = [];

    function flushPara() {
      if (para.length) {
        out.push('<p>' + inline(para.join(' ')) + '</p>');
        para = [];
      }
    }
    function flushList() {
      if (list) { out.push('</' + list + '>'); list = null; }
    }
    function open(kind) {
      if (list !== kind) { flushList(); out.push('<' + kind + '>'); list = kind; }
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var t = line.trim();

      if (/^```/.test(t)) {
        if (inFence) { out.push('<pre><code>' + fence.join('\n') + '</code></pre>'); fence = []; inFence = false; }
        else { flushPara(); flushList(); inFence = true; }
        continue;
      }
      if (inFence) { fence.push(line); continue; }

      if (!t) { flushPara(); flushList(); continue; }

      var h = t.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        flushPara(); flushList();
        // Model headings render as h4+ so they sit under the page's own headings
        var level = Math.min(6, h[1].length + 3);
        out.push('<h' + level + '>' + inline(h[2]) + '</h' + level + '>');
        continue;
      }

      if (/^&gt;\s?/.test(t)) {
        flushPara(); flushList();
        out.push('<blockquote>' + inline(t.replace(/^&gt;\s?/, '')) + '</blockquote>');
        continue;
      }

      var ul = t.match(/^[-*+]\s+(.*)$/);
      if (ul) { flushPara(); open('ul'); out.push('<li>' + inline(ul[1]) + '</li>'); continue; }

      var ol = t.match(/^\d+[.)]\s+(.*)$/);
      if (ol) { flushPara(); open('ol'); out.push('<li>' + inline(ol[1]) + '</li>'); continue; }

      flushList();
      para.push(t);
    }

    if (inFence && fence.length) out.push('<pre><code>' + fence.join('\n') + '</code></pre>');
    flushPara();
    flushList();

    return out.join('\n');
  }

  /**
   * Plain text for one-line previews. The conversation list renders its preview
   * inside <a><p>, where block elements would be invalid HTML, so previews strip
   * markdown rather than render it. Returns text, not markup: callers still escape.
   */
  function stripMarkdown(raw) {
    return String(raw == null ? '' : raw)
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`\n]+)`/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s{0,3}>\s?/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+[.)]\s+/gm, '')
      .replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, '$1')
      .replace(/\*\*([^*\n]+)\*\*/g, '$1')
      .replace(/\*([^*\n]+)\*/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  global.AnswerFormat = {
    formatAnswer: formatAnswer,
    stripMarkdown: stripMarkdown,
    escapeHtml: escapeHtml
  };
})(window);
