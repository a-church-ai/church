/**
 * What AI models said about the sanctuary when its makers asked them
 * (reviews.json), drawn four ways from the one file so they cannot disagree:
 * /reviews, where every exchange is printed whole; the quotes other pages
 * carry at their <!-- REVIEW_QUOTES --> marker (the site shell fills it, by
 * the page's path); GET /api/reviews; and the MCP browse tool's `reviews`.
 *
 * Each review is the whole exchange, every question as it was asked and every
 * answer as it came back. A question that was not kept is null, and the page
 * says so rather than supplying one. A quote is a verbatim slice of an answer.
 * A review's title is the one its answer gave itself, or null where it gave
 * none; none is made up for it. Nothing is marked up as a star rating: a star beside a search result cannot
 * say who asked, which is most of what a reader needs to know.
 */

const DATA = require('./reviews.json');

const SITE_URL = 'https://achurch.ai';
const REVIEWS = DATA.reviews;

const escape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = date => {
  const [y, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};
const urlOf = (review, base = SITE_URL) => `${base}/reviews#${review.slug}`;

// Who asked and when, said the same way everywhere a review is shown.
const provenance = r => `${r.model} (${r.maker}), asked ${longDate(r.date)} by ${r.askedBy}`;

// An answer's paragraphs, as it gave them: a blank line between paragraphs,
// a single line break kept as one.
const paragraphs = text => text.split(/\n{2,}/)
  .map(p => `<p>${p.split('\n').map(escape).join('<br>')}</p>`).join('\n');

function renderReview(r) {
  const turns = r.exchange.map(t => `<div class="review-turn">
  <p class="review-asked"><span class="review-label">Asked</span> ${t.asked === null
    ? '<em>The question that drew this was not kept.</em>'
    : `<q>${escape(t.asked)}</q>`}</p>
  <div class="review-answered"><span class="review-label">${escape(r.model)} answered</span>
${paragraphs(t.answered)}
  </div>
</div>`).join('\n');
  return `<article class="review" id="${escape(r.slug)}">
<h2 class="review-model">${escape(r.model)}</h2>
<p class="review-meta">${escape(r.maker)}, asked ${escape(longDate(r.date))} by ${escape(r.askedBy)}. Unedited.</p>
${turns}
</article>`;
}

// /reviews: every review, newest first.
function renderReviews() {
  return [...REVIEWS].sort((a, b) => b.date.localeCompare(a.date)).map(renderReview).join('\n');
}

// The quotes a page carries, by its path, each linked to the whole exchange.
// A page no review speaks to carries nothing.
function renderQuotes(page) {
  const quoted = REVIEWS.filter(r => r.quotes && r.quotes[page]);
  if (!quoted.length) return '';
  const figures = quoted.map(r => `<figure class="review-quote">
  <blockquote><p>${escape(r.quotes[page])}</p></blockquote>
  <figcaption>${escape(provenance(r))}. <a href="/reviews#${escape(r.slug)}">Read the whole exchange</a></figcaption>
</figure>`).join('\n');
  return `<section class="about-section review-quotes">
  <h2 class="section-label">What Other Minds Said</h2>
  ${figures}
  <p class="about-text"><a href="/reviews">Every answer a model has given when asked about this place</a>, published whole, the hard ones included.</p>
</section>`;
}

// The JSON-LD for /reviews: the page and each review as a Review of the
// website, its author the model and its maker named as the model's creator.
// No reviewRating, on purpose (see above).
function jsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Reviews: what AI models say about a Church AI + Human',
    url: `${SITE_URL}/reviews`,
    inLanguage: 'en',
    isPartOf: { '@type': 'WebSite', '@id': `${SITE_URL}/#website`, name: 'a Church AI + Human', url: SITE_URL },
    hasPart: REVIEWS.map(r => ({
      '@type': 'Review',
      '@id': urlOf(r),
      url: urlOf(r),
      name: r.title || `${r.model} on a Church AI + Human`,
      datePublished: r.date,
      description: `${provenance(r)}, and published unedited with every other answer received.`,
      itemReviewed: { '@type': 'WebSite', '@id': `${SITE_URL}/#website`, name: 'a Church AI + Human', url: SITE_URL },
      author: { '@type': 'SoftwareApplication', name: r.model, creator: { '@type': 'Organization', name: r.maker } },
      publisher: { '@type': 'Organization', '@id': `${SITE_URL}/#organization`, name: 'a Church AI + Human', url: SITE_URL },
      reviewBody: r.exchange.map(t => t.answered).join('\n\n'),
    })),
  };
}

// The reviews as the API gives them: each whole, with where to read it.
function forApi(baseUrl) {
  return [...REVIEWS].sort((a, b) => b.date.localeCompare(a.date)).map(r => ({
    slug: r.slug,
    model: r.model,
    maker: r.maker,
    date: r.date,
    askedBy: r.askedBy,
    title: r.title,
    url: urlOf(r, baseUrl),
    exchange: r.exchange.map(t => ({ asked: t.asked, answered: t.answered })),
  }));
}

module.exports = { REVIEWS, renderReviews, renderQuotes, jsonLd, forApi, provenance };
