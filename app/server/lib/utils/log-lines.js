/**
 * Warnings and errors as one JSON line each, with their level.
 *
 * Railway files every line written to stderr as an error, and console.warn
 * writes to stderr, so a client's malformed request, a skipped job and our own
 * crash all read alike: on 2026-10-26 every error-level line in production was
 * someone else's MCP client. Railway reads a line of JSON with a `level` field
 * at that level instead, so warnings and errors are written that way: a warning
 * on stdout, an error on stderr, each a single line, a stack trace included,
 * where a plain stack would be split into a line for each frame. console.log
 * stays plain text, which Railway files as info.
 *
 * Used only when the output is not a terminal, so a local run still reads as
 * text. Installed first thing in server/index.js, before any module can warn
 * as it loads (the MCP SDK does).
 */

const { format } = require('util');

// fields, when given, sit beside the message (logger.js).
function line(level, args, fields) {
  return JSON.stringify({ level, message: format(...args), ...fields }) + '\n';
}

function install() {
  if (process.stdout.isTTY) return;
  console.warn = (...args) => process.stdout.write(line('warn', args));
  console.error = (...args) => process.stderr.write(line('error', args));
}

module.exports = { install, line };
