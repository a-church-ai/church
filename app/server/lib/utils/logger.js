/**
 * A log line with its level and some fields beside the message.
 *
 * logger.warn('Refused a compressed request body', { path, encoding }) is one
 * line of JSON with level, message and the fields (log-lines.js says why), or,
 * at a terminal, the message with its fields after it. It writes to the
 * process's output and nowhere else: Railway keeps that, and a file inside the
 * container would be gone at the next deploy.
 */

const { line } = require('./log-lines');

function write(level, message, fields) {
  const extra = fields && Object.keys(fields).length ? fields : null;
  if (process.stdout.isTTY) {
    const print = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    return extra ? print(message, extra) : print(message);
  }
  (level === 'error' ? process.stderr : process.stdout).write(line(level, [message], extra));
}

module.exports = {
  info: (message, fields) => write('info', message, fields),
  warn: (message, fields) => write('warn', message, fields),
  // An Error in place of the fields is logged by its message and stack.
  error: (message, fields) => write('error', message, fields instanceof Error ? { error: fields.message, stack: fields.stack } : fields),
};
