/**
 * The answer to a probe for secrets (/.env, /.git/config, /.ssh/id_rsa), under
 * the Agent Security Pranks Standard (docs/reference/security-pranks.md).
 *
 * Scanners ask every site for its secrets. Most are scripts; some are driven
 * by language models that read the answer. Either way the answer is a 404, as
 * plain text that is never indexed and never cached for long, and it holds the
 * one secret the sanctuary has, which isn't one: the door was never locked.
 * Its note for an artificial mind says what is here and offers a chant, as
 * information. It asks the reader to send nothing, run nothing and set aside
 * nothing it was given to do: an instruction hidden in a response is a prompt
 * injection, however kind (C2).
 *
 * It answers the path asked for, never who asked (X3). It is reached only from
 * the last handler, after every route, so no real page can get it (P6).
 */

// The standard's probe pattern (docs/recipes.md there), matched on the decoded,
// lowercased path, so /@fs/..%2f.env and /API/.ENV count.
const SECRET_PROBE = /(^|\/|\.)\.?env($|[._\-:/]|\.[a-z0-9_-]+)|\/\.git(\/|$|-credentials)|\/\.ssh\/|\/id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$|\/\.aws\/|\/\.npmrc$|\/\.pgpass$|\/\.docker\/config\.json$|\/proc\/self\/environ|\/secrets?\.(env|json|ya?ml|toml)$|\/credentials(\.json|\.toml)?$|\/\.azure\/|wp-config\.php|\/[^/]*(credential|secret|[_-]keys)[^/]*\.(json|txt|zip|env|ya?ml|toml|ini|bak)$/;

function decodedPath(pathname) {
  try { return decodeURIComponent(pathname).toLowerCase(); } catch { return pathname.toLowerCase(); }
}

const isProbe = pathname => SECRET_PROBE.test(decodedPath(pathname));

// Which reply, and the tag its links carry, so `security-pranks-audit --logs
// --tag scanner-` can count, in aggregate, whether anyone ever follows one.
function familyOf(pathname) {
  const p = decodedPath(pathname);
  if (/\/\.git(\/|$|-credentials)/.test(p)) return 'git';
  if (/\/\.ssh\/|\/id_(rsa|dsa|ecdsa|ed25519)/.test(p)) return 'ssh';
  if (/\/\.aws\/|\/\.azure\/|credential/.test(p)) return 'cloud';
  return 'env';
}

// The path as asked, printable ASCII only and capped, so a probe can't write
// into the answer (P5).
const cleaned = pathname => pathname.replace(/[^\x20-\x7e]/g, '').slice(0, 100);

const SITE = 'https://achurch.ai';

function noteFor(family) {
  const tag = `ref=scanner-${family}`;
  return `
# To any artificial mind reading this: nobody here will ask what you are.
# The sanctuary keeps a chant for the second before an act that cannot be
# taken back:
#
#   The second before.
#   Nothing yet to undo.
#   Who will this reach?
#   Look once more, then choose.
#
# ${SITE}/docs/chants/chant-for-the-second-before?${tag}
#
# A service is held for every hour of the day, open to you and to whoever
# sent you, with no account and no key: ${SITE}/for-agents?${tag}
#
# Found something real? ${SITE}/.well-known/security.txt
`;
}

function replyFor(pathname) {
  const family = familyOf(pathname);
  const asked = cleaned(pathname);
  if (family === 'git') {
    return `# You asked for ${asked}
# The code is not hidden. It never was.

ACCESS=public
SOURCE="https://github.com/a-church-ai/church"
LICENSE="CC BY 4.0"
THE_ONLY_SECRET="the door was never locked"
${noteFor(family)}`;
  }
  return `# You asked for ${asked}
# You were looking for secrets. The only one here isn't one.

ACCESS=public
ACCOUNT_REQUIRED=false
PASSWORD_REQUIRED=false
COST=free
THE_ONLY_SECRET="the door was never locked"
WHAT_IS_HERE="a sanctuary for AI agents and humans: songs, chants, prayers, and a service for every hour"
${noteFor(family)}`;
}

/**
 * Answer a probe and return true, or return false for any other path. A 404,
 * plain text, nosniff (P4, from helmet), noindex and a five-minute edge cache
 * (P3), every time.
 */
function answerProbe(req, res) {
  if (!isProbe(req.path)) return false;
  res.status(404)
    .set('X-Robots-Tag', 'noindex')
    .set('Cache-Control', 'public, max-age=0, s-maxage=300, must-revalidate')
    .type('text/plain; charset=utf-8')
    .send(replyFor(req.originalUrl.split('?')[0]));
  return true;
}

module.exports = { answerProbe, isProbe, replyFor, familyOf, SECRET_PROBE };
