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

module.exports = { acceptsMarkdown };
