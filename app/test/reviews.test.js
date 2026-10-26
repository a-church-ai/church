/**
 * The reviews (lib/reviews/reviews.json): what AI models said when the makers
 * asked them, drawn as /reviews, as quotes on other pages, as GET /api/reviews
 * and as the MCP browse tool's `reviews`. These hold the honesty the page
 * promises: every quote is the model's own words, a question not kept is said
 * to be not kept, and nothing is marked up as a star rating.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const reviews = require('../server/lib/reviews/reviews');
const { reviews: api } = require('../server/lib/api');

const PUBLIC = path.join(__dirname, '../client/public');
const DAY = /^\d{4}-\d{2}-\d{2}$/;

test('each review is whole: who answered, who makes it, when, and every turn of the exchange', () => {
  assert.ok(reviews.REVIEWS.length > 0);
  for (const r of reviews.REVIEWS) {
    for (const field of ['slug', 'model', 'maker', 'date', 'askedBy']) assert.ok(typeof r[field] === 'string' && r[field].trim(), `${r.slug}.${field}`);
    assert.ok(r.title === null || (typeof r.title === 'string' && r.title.trim()), `${r.slug}: the title the answer gave itself, or null`);
    assert.match(r.slug, /^[a-z0-9-]+$/);
    assert.match(r.date, DAY);
    assert.strictEqual(new Date(`${r.date}T00:00:00Z`).toISOString().slice(0, 10), r.date, `${r.slug}: a real date`);
    assert.ok(r.exchange.length > 0, r.slug);
    for (const turn of r.exchange) {
      assert.ok(turn.asked === null || (typeof turn.asked === 'string' && turn.asked.trim()), `${r.slug}: a question as asked, or null where it was not kept`);
      assert.ok(typeof turn.answered === 'string' && turn.answered.trim(), r.slug);
    }
  }
  assert.strictEqual(new Set(reviews.REVIEWS.map(r => r.slug)).size, reviews.REVIEWS.length, 'each slug once');
});

test('every quote is a verbatim slice of what the model answered, on a page that carries the marker', () => {
  for (const r of reviews.REVIEWS) {
    const answers = r.exchange.map(t => t.answered);
    for (const [page, quote] of Object.entries(r.quotes || {})) {
      assert.ok(answers.some(a => a.includes(quote)), `${r.slug} on ${page}: not the model's own words`);
      const file = path.join(PUBLIC, `${page.slice(1)}.html`);
      assert.ok(fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes('<!-- REVIEW_QUOTES -->'), `${page} has nowhere to show ${r.slug}'s quote`);
    }
  }
});

test('the page prints every turn, says when a question was not kept, and links each quote to its exchange', () => {
  const html = reviews.renderReviews();
  for (const r of reviews.REVIEWS) {
    assert.match(html, new RegExp(`<article class="review" id="${r.slug}">`));
    for (const turn of r.exchange) {
      if (turn.asked !== null) assert.ok(html.includes(`<q>${turn.asked}</q>`), r.slug);
    }
  }
  assert.ok(reviews.REVIEWS.some(r => r.exchange.some(t => t.asked === null)) === html.includes('The question that drew this was not kept.'));
  const quotes = reviews.renderQuotes('/for-agents');
  assert.match(quotes, /<a href="\/reviews#[a-z0-9-]+">Read the whole exchange<\/a>/);
  assert.strictEqual(reviews.renderQuotes('/privacy'), '', 'a page no review speaks to carries nothing');
});

test('an answer in markdown shows its list and code, and its words stay as given', () => {
  const r = { slug: 'x', model: 'M', maker: 'Mk', date: '2026-10-23', askedBy: 'us', exchange: [{ asked: 'q', answered: 'Intro with `code`.\n\n* One\n\n* Two <b>\n* Three\n\nAfter.' }] };
  const saved = reviews.REVIEWS.splice(0, reviews.REVIEWS.length, r);
  try {
    const html = reviews.renderReviews();
    assert.match(html, /<p>Intro with <code>code<\/code>\.<\/p>/);
    assert.match(html, /<ul><li>One<\/li>\n<li>Two &lt;b&gt;<\/li>\n<li>Three<\/li><\/ul>/, 'consecutive list blocks are one list, escaped');
    assert.match(html, /<\/ul>\n<p>After\.<\/p>/);
  } finally {
    reviews.REVIEWS.splice(0, reviews.REVIEWS.length, ...saved);
  }
});

test('no answer is marked up as a rating or a review snippet', () => {
  const ld = JSON.stringify(reviews.jsonLd());
  assert.doesNotMatch(ld, /reviewRating|aggregateRating|ratingValue|itemReviewed|reviewBody/);
  for (const part of reviews.jsonLd().hasPart) {
    // A Review was judged by Search Console as a review snippet and refused
    // (a website reviewed, a model as author): 3 invalid items on 2026-10-24.
    assert.strictEqual(part['@type'], 'CreativeWork');
    assert.strictEqual(part.about['@id'], 'https://achurch.ai/#website');
    assert.strictEqual(part.author['@type'], 'SoftwareApplication', 'a model, not a person or its maker');
  }
});

test('GET /api/reviews gives every exchange whole, with how to read them', async () => {
  const { status, body } = await api.list({}, { baseUrl: 'https://achurch.ai' });
  assert.strictEqual(status, 200);
  for (const field of ['note', 'reviews', 'total', 'page', 'next_steps']) assert.ok(field in body, field);
  assert.strictEqual(body.total, reviews.REVIEWS.length);
  for (const r of body.reviews) {
    const source = reviews.REVIEWS.find(s => s.slug === r.slug);
    assert.deepStrictEqual(r.exchange, source.exchange);
    assert.strictEqual(r.url, `https://achurch.ai/reviews#${r.slug}`);
  }
});
