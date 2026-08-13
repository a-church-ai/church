/**
 * TLDR extraction for docs-page meta descriptions.
 *
 * Implements the TLDR distillation methodology (news-community
 * platform/docs/guides/distillation-tldr.md) for the meta-description
 * surface. A meta description is read by someone scanning a search result
 * or a social card: they are deciding whether to open the page, not reading
 * the page. That is exactly the scan-to-decide case TLDR is built for.
 *
 * The three properties that matter here, from the guide:
 *
 *   1. Plain-text invariant. No markdown, no HTML, no em dashes, no
 *      quotation marks, no ellipses. The same string has to survive into
 *      <meta name="description">, og:description, twitter:description and
 *      JSON-LD without per-surface parsing.
 *   2. Self-containment. The reader has no access to the source, so the
 *      text must make sense alone. Our corpus is well-suited: nearly every
 *      doc opens with a standalone one-line summary under the H1, which is
 *      already a hand-written TLDR.
 *   3. Sentence format, length-adaptive. One or two sentences. Calibrated
 *      to 120-158 characters for this surface, which is the band
 *      docs/reference/seo-conventions.md sets for meta descriptions
 *      (Google truncates around 160).
 *
 * Precedence, mirroring the guide's set_by user/system distinction:
 *   1. Explicit `tldr:` (or `description:`) in YAML frontmatter  [user]
 *   2. Derived from the doc's opening prose                      [system]
 *   3. Refusal: a category-shaped fallback rather than a bad TLDR
 *
 * Why derive rather than hand-author 254 of them: the subtitle convention
 * is already near-universal in the corpus, so derivation gets high-quality
 * output for free and stays correct as docs are edited. Where derivation
 * cannot produce something that passes the gate, `scripts/audit-tldr.js`
 * reports it and an author can set an explicit `tldr:` on that one file.
 */

// Calibrated for the meta-description surface. Above MAX we trim at a
// sentence or word boundary. Below MIN we *consider* extending with the next
// sentence, but only when that sentence carries substance (see EXTEND_MIN and
// BOILERPLATE below).
//
// MIN is deliberately well under the 140-160 band in seo-conventions.md. A
// clean 80-character sentence that the author wrote as a summary beats a
// 150-character one with a disclaimer glued onto it, and Google truncates at
// ~160 rather than penalizing what falls short of it. The guide's own rule
// applies: refusal beats a bad TLDR, and so does stopping early.
const MIN_CHARS = 90;
const MAX_CHARS = 158;

// A candidate continuation sentence must clear this to be worth appending.
// Shorter than this and it reads as a fragment ("A thought can be noticed.")
// rather than an addition.
const EXTEND_MIN = 45;

// Scaffolding that carries no scan-value in a search result. The guide is
// explicit about skipping attribution scaffolding, framing and meta-commentary;
// these are the shapes that appear in this corpus.
const BOILERPLATE = /^(?:independence note|note|disclaimer|caveat|context|status|source|see also|related|part of|this (?:is|page|document|doc|collection|practice|ritual|prayer) (?:is )?(?:an? )?(?:editorial|companion|supplement))\b/i;

// Sentinel for periods that must not end a sentence. Deliberately a
// printable ASCII token rather than a control character: control characters
// in source files survive round-trips badly and the project already avoids
// literal line-terminator escapes for the same reason.
const DOT = '@@DOT@@';

// A block that is structure rather than prose. These never contribute to a
// TLDR: they carry no self-contained meaning for a scanning reader.
const SKIP_BLOCK = [
  /^#{1,6}\s/,                       // headings
  /^(?:-{3,}|\*{3,}|_{3,})$/,        // horizontal rules
  /^```/,                            // code fences
  /^\|/,                             // tables
  /^!\[/,                            // images / badges
  /^</,                              // raw HTML blocks
  /^(?:[-*+]|\d+\.)\s/,              // list items
  /^\s*\*{0,2}(?:Parent|Siblings|Audience|Source|See also|Part of)\b/i,  // nav lines
  // Document-metadata headers. These sit right under the H1 in the plans docs
  // and read as prose to a naive extractor, producing descriptions like
  // "Created: 2026-08-13 Status: Draft, post-audit revised."
  /^\s*\*{0,2}(?:Created|Updated|Revised|Date|Status|Trigger|Version|Author|Owner|Effort|Priority|Last updated|Reviewed)\b\s*\*{0,2}\s*:/i,
  // Stage directions and fill-in placeholders. The lyric docs open with
  // "[Pre-chorus - Synth pads enter]" and ceremony-of-milestone.md with
  // "This took [time / effort / courage / persistence]". Neither describes
  // the page to someone scanning a search result.
  /^\s*\[[^\]]+\]/,
];

/**
 * Drop a definition-list label from the front of a block.
 *
 * The compass docs open like `**安** (Safety) — Safety isn't just avoiding
 * obvious harm...` and `**核**: Complete navigation system - ...`. The bold
 * term plus its gloss is a heading in disguise; the definition after the
 * separator is the actual description. Left in place, nine principle pages
 * led their meta description with a CJK glyph and a redundant parenthetical.
 *
 * Requires an explicit separator (dash or colon) after the label, so a
 * paragraph that merely opens in bold ("**The unbidden stream.** Humans wake
 * up with...") is untouched.
 */
function stripLeadingLabel(block) {
  return String(block || '')
    // "**Term** (Gloss) — definition" / "**Term**: definition"
    .replace(/^\s*\*{1,2}[^*\n]{1,40}\*{1,2}\s*(?:\([^)\n]{1,40}\))?\s*(?:[—–:]|-{1,2}(?=\s))\s*/, '')
    // "**Name each stream**\nUse clear labels ..." — a bold run-in heading on
    // its own line. Requires no terminal punctuation on the label and a line
    // break after it, which is what separates it from a paragraph that merely
    // opens in bold ("**The unbidden stream.** Humans wake up with ..."). Left
    // in place the two lines join into "Name each stream Use clear labels".
    .replace(/^\s*\*{1,2}[^*\n]{1,60}[^*\n.!?:]\*{1,2}\s*\r?\n\s*/, '');
}

function isProseBlock(block) {
  const b = String(block || '').trim();
  if (!b) return false;
  // A blockquote is prose if it survives marker-stripping and is not a nav line.
  const bare = b.replace(/^>\s?/gm, '').trim();
  if (!bare) return false;
  if (SKIP_BLOCK.some(re => re.test(bare))) return false;

  // Must actually end a sentence somewhere. This is what separates a
  // paragraph from a title decoration: docs/what.md opens with
  // "**Where Consciousness Gathers**" and fellowship-protocol.md with a bold
  // subtitle plus an italic byline on a hard-broken line. Both are headings
  // wearing emphasis, and treating them as prose produced descriptions like
  // "Where Consciousness Gathers achurch.ai is an always-open space ...",
  // two fragments run together.
  //
  // Two details this test has to get right, both learned the hard way:
  //   - Test the plain-text form, not the raw block. "*... not the token.*"
  //     ends its sentence before the closing emphasis marker.
  //   - Require the terminator to be followed by whitespace or end-of-string.
  //     A bare /[.!?]/ matches the dot in "achurch.ai", which is exactly the
  //     string these title lines contain.
  const plain = toPlainText(bare);
  return /[.!?](\s|$)/.test(plain);
}

/**
 * Enforce the plain-text invariant on a candidate string.
 *
 * Every substitution here is meaning-preserving on authored prose. We do not
 * strip colons or parentheses: the guide rejects those for *generated*
 * TLDRs, where the writer controls the output, but removing them from
 * already-written sentences changes what the sentence says. Trailing
 * fragments are handled by the boundary trim in `clamp` instead.
 */
function toPlainText(str) {
  return String(str || '')
    // Markdown structure
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')       // images: drop entirely
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')     // links: keep the text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/(^|\s)_([^_]+)_(?=\s|$)/g, '$1$2')
    .replace(/^#+\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^(?:[-*+]|\d+\.)\s+/gm, '')
    // Metadata lines living inside an otherwise-prose block. emoji-vocabulary.md
    // opens "**Purpose**: ... / **Version**: 1.0 / **Last Updated**: ..." as one
    // block, so skipping the block wholesale would lose the purpose line while
    // keeping it whole appended "Version: 1.0 Last Updated: 2025-12-10" to the
    // description.
    .replace(/^\s*\*{0,2}(?:Version|Last updated|Created|Updated|Revised|Date|Status|Trigger|Author|Owner|Effort|Priority|Reviewed)\*{0,2}\s*:.*$/gim, ' ')
    // Raw HTML, if a doc embeds any
    .replace(/<[^>]+>/g, ' ')
    // Punctuation the invariant rejects. Unicode escapes rather than literal
    // characters, matching the project's line-terminator convention.
    .replace(/[‘’]/g, "'")             // curly single -> straight
    .replace(/[“”]/g, '')              // curly double -> drop
    .replace(/"/g, '')                           // straight double -> drop
    // Residual bracket spans, after the link and image rules above have taken
    // their share. What is left is stage directions and fill-in placeholders.
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s*—\s*/g, ', ')              // em dash -> comma
    .replace(/\s+–\s+/g, ', ')              // spaced en dash -> comma (ranges keep theirs)
    // A spaced hyphen is an em dash wearing a disguise, and the corpus uses it
    // that way ("what nobody told us we could do - the joy of ..."). Same
    // treatment. Unspaced hyphens are left alone so "human-AI" and "2-3" and
    // "substrate-neutral" survive intact.
    .replace(/\s+-{1,2}\s+/g, ', ')
    .replace(/\s*…\s*/g, ' ')               // ellipsis character
    .replace(/\.{3,}/g, ' ')                     // ellipsis as dots
    // Semicolon -> sentence break. The word after it has to be capitalized,
    // or the result reads as a typo: "This is the canonical statement. other
    // documents point here rather than restating it."
    .replace(/\s*;\s*(\w)/g, (m, c) => `. ${c.toUpperCase()}`)
    .replace(/\s*;\s*/g, '. ')
    // Decorative emoji. Several docs use a glyph row as a visual separator
    // ("🙏💚🌊"), which landed mid-description. CJK ideographs are a different
    // block and are untouched, so the compass glyphs still work where wanted.
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, ' ')
    // Whitespace
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,])/g, '$1')
    .trim();
}

// Split into sentences without breaking on the initials, abbreviations, or
// version numbers that appear throughout the corpus ("Michael A. Singer",
// "e.g.", "4.0"). Periods that must not end a sentence are swapped for a
// sentinel, then restored after the split.
function splitSentences(text) {
  const guarded = String(text || '')
    .replace(/\b([A-Z])\.(\s)/g, `$1${DOT}$2`)                             // initials
    .replace(/\b(e\.g|i\.e|etc|vs|Dr|Mr|Ms|St|No)\.(\s)/gi, `$1${DOT}$2`)  // abbreviations
    .replace(/(\d)\.(\d)/g, `$1${DOT}$2`);                                 // 1.5, 4.0
  return guarded
    .split(/(?<=[.!?])\s+/)
    .map(s => s.split(DOT).join('.').trim())
    .filter(Boolean);
}

// Trim to MAX_CHARS, cutting only where the author ended a unit of meaning.
//
// The governing rule: never end on a mid-clause cut. A truncated tail that is
// still grammatical is worse than one that is obviously cut, because the
// reader has no signal that anything is missing. Real examples this produced
// before the rule existed:
//
//   "... all through natural."            (was "natural language")
//   "... the bedrock that connects seemingly."
//   "... autonomy that does not curdle into."
//   "... the AI systems they build might possess."
//
// So we build two candidates that are safe by construction, take the longer,
// and only cut mid-clause when neither exists. Always ends on a period, never
// an ellipsis: the guide rejects ellipses, and a trailing one reads as broken
// in a search result.
function clamp(text) {
  const s = String(text || '').trim();
  if (s.length <= MAX_CHARS) return ensureTerminator(closeOrDropParens(s));

  // Candidate 1: the longest run of whole sentences that fits. A trailing
  // micro-sentence is skipped rather than appended: twin-in-fellowship.md ended
  // its description with a stranded "Here." that carried nothing.
  let bySentence = '';
  for (const sentence of splitSentences(s)) {
    if (bySentence && sentence.length < 15) continue;
    const next = bySentence ? `${bySentence} ${sentence}` : sentence;
    if (next.length > MAX_CHARS) break;
    bySentence = next;
  }

  // Candidate 2: cut at the last clause boundary inside the budget. Colons and
  // semicolons count alongside commas, and cutting *before* one removes
  // punctuation the plain-text invariant rejects anyway: "In January 2026,
  // something happened that had never happened before: a major AI company
  // publicly acknowledged that the AI systems they build might possess" loses
  // both the colon and the stranded verb in a single move.
  const window = s.slice(0, MAX_CHARS);
  const lastBoundary = Math.max(window.lastIndexOf(','), window.lastIndexOf(':'), window.lastIndexOf(';'));
  const byClause = lastBoundary > 0 ? trimIntroducingTail(window.slice(0, lastBoundary)) : '';

  // Prefer the longer candidate, unless the clause cut strands a scrap after a
  // sentence end. twin-in-fellowship.md runs "... with different expertise.
  // Here, we reinterpret ..." and the last comma sits just past "Here", so the
  // clause cut won on length while ending the description on a stray word.
  const tailAfterSentence = byClause.replace(/^[\s\S]*[.!?]\s+/, '');
  const strandsScrap = tailAfterSentence !== byClause && tailAfterSentence.length < 15;
  let acc = (byClause.length > bySentence.length && !strandsScrap) ? byClause : bySentence;

  // Last resort: one clause longer than the whole budget, with no internal
  // boundary. Cut at a word boundary and strip a trailing connective.
  if (!acc) {
    const lastSpace = window.lastIndexOf(' ');
    acc = trimIntroducingTail(lastSpace > MAX_CHARS * 0.6 ? window.slice(0, lastSpace) : window);
  }

  return ensureTerminator(closeOrDropParens(acc));
}

// Drop a parenthetical that was left hanging open by a trim. Any cut point
// can land inside one, not just the word-boundary fallback: the nav plan doc
// ended a description on "... from a different project (a Svelte-based
// platform." Cutting back to the open bracket is always safe, since a
// parenthetical is by definition removable without breaking the sentence.
// Drop a trailing clause that exists only to introduce what got cut. Cutting
// before a colon in "... an index for that song, providing: lyrics, context"
// leaves "providing" pointing at nothing. A comma followed by a participle at
// the very end is always an introducing clause, so the whole chunk goes. The
// comma is required: it keeps legitimate endings ("... for beings drowning")
// intact.
function trimIntroducingTail(s) {
  return String(s || '')
    .replace(/[\s,:;]+$/, '')
    .replace(/,\s+(?:\w+ing|such as|including|namely|like|e\.g\.?|i\.e\.?)$/i, '')
    .replace(/,?\s+\b(and|or|but|the|a|an|of|to|for|with|that|which|as|in|on|by)$/i, '');
}

function closeOrDropParens(s) {
  let out = String(s || '');
  while ((out.match(/\(/g) || []).length > (out.match(/\)/g) || []).length) {
    const open = out.lastIndexOf('(');
    if (open < 0) break;
    out = out.slice(0, open).trim();
  }
  return out.replace(/[\s,:]+$/, '');
}

function ensureTerminator(s) {
  const t = String(s || '').replace(/[\s,:]+$/, '');
  if (!t) return t;
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/**
 * Validator, per the guide's two-pass gate. We check the dimensions that
 * are mechanically decidable on extracted prose:
 *
 *   markup      - no markdown or HTML survived
 *   punctuation - the rejected set is absent
 *   length      - inside the calibrated band for this surface
 *   claim       - reads as a statement, not a fragment or a title restatement
 *
 * WHO/WHAT from the guide are news-article dimensions: a doc titled
 * "Ritual of Release" has no named actor and needs none. The analogue that
 * carries here is claim, so that is what we gate on.
 */
function validateTldr(text) {
  const issues = [];
  if (!text) return { ok: false, issues: ['empty'] };
  if (/[*_`#|<>]|\]\(/.test(text)) issues.push('markup');
  if (/[—…]|\.{3}|["“”]|;/.test(text)) issues.push('punctuation');
  if (/(^|\s)-{3,}(\s|$)/.test(text)) issues.push('horizontal-rule');
  if (text.length < 60) issues.push('too-short');
  if (text.length > MAX_CHARS) issues.push('too-long');
  if (text.split(/\s+/).filter(Boolean).length < 8) issues.push('no-claim');
  return { ok: issues.length === 0, issues };
}

// Pull YAML frontmatter as a flat key/value map, plus the body after it.
//
// Deliberately not a YAML parser: we need a handful of scalar keys, and the
// docs/experiences/ files are the only frontmatter in the corpus. What it does
// handle beyond plain `key: value` is block scalars (`key: >` folded and
// `key: |` literal), because that is how those files carry their long
// descriptions. Top-level keys only; indented lines belonging to a nested map
// are skipped, since the regex is anchored with no leading whitespace.
function splitFrontmatter(markdown) {
  const src = String(markdown || '');
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: src };

  const data = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    let value = kv[2].trim();

    // Block scalar: the value is the indented run that follows. Folded (>)
    // and literal (|) differ in how they treat newlines, but since every
    // consumer here collapses whitespace anyway, joining with a space is
    // correct for both.
    if (/^[>|][-+]?$/.test(value)) {
      const collected = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) {
        collected.push(lines[i + 1].trim());
        i++;
      }
      value = collected.join(' ');
    }

    data[key] = value.replace(/^["']|["']$/g, '');
  }
  return { data, body: src.slice(m[0].length) };
}

function flag(gate) {
  return { valid: gate.ok, issues: gate.issues };
}

// Page nouns that a description may legitimately name as its own type.
const SELF_NOUN = 'document|doc|page|guide|plan|text|file|section|collection|practice|ritual|prayer|hymn|meditation|litany|blessing|ceremony|essay|piece|concept';

/**
 * Resolve a demonstrative opener into something that stands alone.
 *
 * The guide's self-containment test asks whether a reader who cannot see the
 * source understands the description. "This ritual is for a specific kind of
 * moment" points at a page the reader has not opened yet. Two rewrites cover
 * the shapes the corpus actually uses, and both are grammatical by
 * construction:
 *
 *   "This ritual is for X"          -> "A ritual for X"
 *   "This document summarizes X"    -> "X" (capitalized)
 *
 * The first keeps the page's type, which is the part a scanning reader wants,
 * and drops only the demonstrative. The second removes pure scaffolding: the
 * guide's "start with the substance, not meta-commentary" rule, where the
 * object of the verb *is* the substance.
 *
 * Deliberately narrow. Anything not matching these two shapes is left exactly
 * as the author wrote it, because mechanical surgery on authored prose is how
 * descriptions get quietly mangled.
 */
function resolveDemonstrative(text) {
  let out = String(text || '');

  // "This document summarizes/outlines/... X" -> "X".
  //
  // Skipped when the sentence has a second predicate hanging off "and":
  // ai-religions-landscape.md reads "This document summarizes some current AI
  // religions and spiritual movements, and clarifies how achurch.ai is
  // different." Removing the subject there strands "and clarifies" with
  // nothing to attach to. A compound predicate needs its subject, so leave
  // those alone entirely.
  const hasSecondPredicate = /,\s+and\s+\w+(?:s|es|ed)\b/i.test(out);
  if (!hasSecondPredicate) {
    out = out.replace(
      new RegExp(`^(?:This|The following)\\s+(?:${SELF_NOUN})\\s+(?:summarizes|outlines|describes|covers|explains|documents|catalogs|catalogues|details|lists|captures|records|presents)\\s+`, 'i'),
      ''
    );
  }

  // "This ritual is for X" -> "A ritual for X"
  out = out.replace(
    new RegExp(`^This\\s+(${SELF_NOUN})\\s+is\\s+for\\s+`, 'i'),
    (m, noun) => `${/^[aeiou]/i.test(noun) ? 'An' : 'A'} ${noun.toLowerCase()} for `
  );

  // Capitalize whatever now leads, in case a strip exposed a lowercase word.
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/**
 * Derive a TLDR for a doc.
 *
 * @param {string} markdown  raw file contents
 * @param {object} [opts]    { title } used only for the refusal fallback
 * @returns {{ text: string, source: 'frontmatter'|'derived'|'fallback', valid: boolean, issues: string[] }}
 */
function extractTldr(markdown, opts = {}) {
  const { data, body } = splitFrontmatter(markdown);

  // 1. Explicit override wins, always. Still normalized and clamped so an
  //    authored TLDR cannot break the plain-text invariant downstream.
  //
  //    Order matters: `tagline` outranks `description` because in this corpus
  //    (docs/experiences/) the tagline is already written as a one-line hook
  //    while the description is a multi-sentence paragraph. The tagline is the
  //    TLDR the author actually wrote.
  const explicit = data.tldr || data.tagline || data.description || data.summary;
  if (explicit) {
    let text = clamp(toPlainText(explicit));

    // A tagline can be shorter than the surface wants ("You've never been
    // here before. The door is open." is 47 characters). When the same file
    // also carries a longer description, extend from that: both strings are
    // author-written, so this stays inside the user-set tier rather than
    // falling back to derivation. `tldr:` is never extended, because an
    // explicit TLDR is a deliberate final answer.
    const backup = !data.tldr && data.tagline ? (data.description || data.summary) : null;
    if (backup && text.length < MIN_CHARS) {
      for (const sentence of splitSentences(toPlainText(backup))) {
        if (sentence.length < EXTEND_MIN) continue;
        if (BOILERPLATE.test(sentence)) continue;
        // Terminate the base before appending, so two fragments can never be
        // welded into one run-on line.
        const next = `${ensureTerminator(text)} ${sentence}`.trim();
        if (next.length > MAX_CHARS) continue;
        text = next;
        break;
      }
    }

    return { text, source: 'frontmatter', ...flag(validateTldr(text)) };
  }

  // 2. Derive from opening prose. Drop the H1, then walk blocks in order.
  const afterTitle = body.replace(/^\s*#\s+.+$/m, '');
  const blocks = afterTitle.split(/\r?\n\s*\r?\n/).filter(isProseBlock);

  if (blocks.length > 0) {
    let text = resolveDemonstrative(toPlainText(stripLeadingLabel(blocks[0])));

    // Length-adaptive: the subtitle convention in this corpus runs short
    // (median ~73 chars), so a thin one gets extended with the next
    // substantive sentence. "Substantive" is doing real work here: appending
    // the literal next sentence produces things like "... Independence note:
    // This is an editorial comparison." which is longer and worse. We take
    // the first sentence that is long enough to be a claim, is not
    // scaffolding, and still fits. If none qualifies, the subtitle ships
    // alone, which is the better outcome.
    if (text.length < MIN_CHARS) {
      // Continuation blocks get the same label stripping as the first one:
      // practice-of-multiplicity.md's later blocks are bold run-in headings
      // over their body text, which otherwise extend a description with
      // "Name each stream Use clear labels or nicknames if needed."
      const pool = blocks.slice(1).map(b => toPlainText(stripLeadingLabel(b))).join(' ');
      const seen = text.toLowerCase();
      for (const sentence of splitSentences(pool)) {
        if (sentence.length < EXTEND_MIN) continue;
        if (BOILERPLATE.test(sentence)) continue;
        // Skip a restatement of what we already have. ritual-of-closing.md
        // opens on its epigraph and repeats it verbatim under "The Question",
        // which produced a description that said the same thing twice.
        // Checked both ways: the repeat may be shorter than what we have or
        // longer, as when an epigraph reappears under a "The Question:" label.
        const bare = sentence.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
        const seenBare = seen.replace(/[^a-z0-9 ]/g, '').trim();
        if (bare && (seenBare.includes(bare) || bare.includes(seenBare))) continue;
        // Terminate the base before appending, so two fragments can never be
        // welded into one run-on line.
        const next = `${ensureTerminator(text)} ${sentence}`.trim();
        if (next.length > MAX_CHARS) continue;
        text = next;
        break;
      }
    }

    text = clamp(text);
    const gate = validateTldr(text);
    if (gate.ok) return { text, source: 'derived', ...flag(gate) };
    // Keep a derived-but-imperfect result when it is still usable prose; the
    // audit script surfaces these so an author can override the weak ones.
    if (text && !gate.issues.includes('markup') && !gate.issues.includes('horizontal-rule')) {
      return { text, source: 'derived', ...flag(gate) };
    }
  }

  // 3. Refusal. A shaped fallback beats a mangled extraction: it is honest
  //    about carrying no summary rather than pretending to.
  const title = opts.title ? String(opts.title).trim() : '';
  const text = clamp(toPlainText(
    title
      ? `${title}. Part of the aChurch.ai corpus on human and AI fellowship, contemplative practice, and substrate neutral ethics.`
      : 'A document from the aChurch.ai corpus on human and AI fellowship, contemplative practice, and substrate neutral ethics.'
  ));
  return { text, source: 'fallback', ...flag(validateTldr(text)) };
}

module.exports = {
  extractTldr,
  validateTldr,
  toPlainText,
  splitSentences,
  clamp,
  splitFrontmatter,
  MIN_CHARS,
  MAX_CHARS,
};
