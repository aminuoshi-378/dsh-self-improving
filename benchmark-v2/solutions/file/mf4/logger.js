const { appendDedup } = require('./dedup.js')
const { rotate } = require('./rotate.js')

function appendLog(fs, base, opts, line) {
  if (fs.exists(base) && fs.lineCount(base) >= opts.maxLines) rotate(fs, base, opts.keep)
  return appendDedup(fs, base, line, opts.window)
}
module.exports = { appendLog }
