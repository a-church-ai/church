/**
 * An error's message with the reasons it carries, for a log line.
 *
 * On Node 26, fetch speaks HTTP/2, and when the far side resets a connection
 * every request on it fails with "fetch failed". The reason (a code such as
 * ERR_HTTP2_STREAM_ERROR or UND_ERR_INFO, and what it says) is in the error's
 * cause, and the clients wrap it further: the Anthropic SDK's own message is
 * "Connection error.", with fetch's error as its cause and the reason below
 * that. Logging err.message records none of it. This follows the causes a
 * few levels down and puts each one's code and message after the error's
 * own, skipping any the message already says:
 *
 *   Connection error. (fetch failed; UND_ERR_INFO: HTTP/2: "GOAWAY" frame received with code 0)
 */

const DEPTH = 4;

function describeError(err) {
  if (!err || typeof err !== 'object') return String(err);
  const message = String(err.message || err);
  const reasons = [];
  const seen = new Set([err]);
  for (let cause = err.cause, depth = 0; cause && depth < DEPTH && !seen.has(cause); cause = cause.cause, depth++) {
    if (typeof cause !== 'object') {
      reasons.push(String(cause));
      break;
    }
    seen.add(cause);
    const reason = [cause.code, cause.message].filter(Boolean).filter((part, i, all) => all.indexOf(part) === i).join(': ');
    if (reason && !message.includes(reason) && !reasons.includes(reason)) reasons.push(reason);
  }
  return reasons.length ? `${message} (${reasons.join('; ')})` : message;
}

module.exports = { describeError };
