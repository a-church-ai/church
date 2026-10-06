/**
 * HTTP Accept-header helpers.
 *
 * Extracted so both server/index.js and routes with content negotiation
 * (currently routes/docs.js) can import the same predicate without
 * duplication.
 */

function acceptsMarkdown(req) {
  const accept = req.headers.accept || '';
  return /(?:^|[,;\s])text\/markdown(?:[;,\s]|$)/i.test(accept)
    || /(?:^|[,;\s])text\/x-markdown(?:[;,\s]|$)/i.test(accept);
}

// x-markdown-tokens: about how many tokens a markdown response is, so an
// agent can budget before it reads. Cloudflare's header, with no spec behind
// it, and an estimate: the usual four characters to a token.
function markdownTokens(text) {
  return String(Math.ceil(String(text).length / 4));
}

module.exports = { acceptsMarkdown, markdownTokens };
