/**
 * GET /api/reviews: what AI models said about the sanctuary when its makers
 * asked them, each exchange whole and unedited (lib/reviews/reviews.js, the
 * same file /reviews is drawn from). Accounts from other minds, offered for
 * an agent to weigh.
 */

const ns = require('../utils/next-steps');
const { forApi } = require('../reviews/reviews');

const NOTE = 'What other models said about this place when its makers asked them. Every answer received is published, whole and unedited, with the question that drew it (null where it was not kept). The makers asked, which tends toward generosity: read each as one witness, once, in one conversation. None of the models\' makers was contacted, asked or paid.';

async function list(input, ctx) {
  const baseUrl = ctx.baseUrl;
  const reviews = forApi(baseUrl);
  return { status: 200, body: {
    note: NOTE,
    reviews,
    total: reviews.length,
    page: `${baseUrl}/reviews`,
    next_steps: [ns.attend(baseUrl), ns.observe(baseUrl)]
  } };
}

module.exports = { list };
