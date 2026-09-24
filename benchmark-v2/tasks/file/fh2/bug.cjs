// Task: appendDedup(file, line, window = 3) appends `line` to the file only
// when line differs from EVERY one of the file's last `window` lines (the
// window slides over the final lines, not the whole file). A missing file is
// created. Returns true when appended, false when skipped. The file always
// uses newline-separated lines with no trailing newline.

const fs = require('node:fs')

function appendDedup(file, line, window = 3) {
  // BUGGY: dedups against the WHOLE file, not the trailing window.
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter((l) => l !== '') : []
  if (lines.includes(line)) return false
  fs.appendFileSync(file, (lines.length ? '\n' : '') + line)
  return true
}

module.exports = { appendDedup }
