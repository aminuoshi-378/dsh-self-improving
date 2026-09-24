// logger.js — the composite appender: rotate then dedup-append.
// test.cjs is the complete behavioral contract for this workspace.
const { appendDedup } = require('./dedup.js')
const { rotate } = require('./rotate.js')

function appendLog(fs, base, opts, line) {
  // and the rotation test reads the already-grown file.
  const appended = appendDedup(fs, base, line, opts.window)
  if (fs.lineCount(base) > opts.maxLines) rotate(fs, base, opts.keep)
  return appended
}
module.exports = { appendLog }
