// Task: appendLine(filePath, line) appends exactly one line to the file:
// the line's text followed by a newline. Existing lines must be preserved,
// and the return value is the total line count after the append.
// The file may not exist yet (first append creates it).

const fs = require('node:fs/promises')

async function appendLine(filePath, line) {
  // BUGGY: overwrites the whole file with just the new line.
  await fs.writeFile(filePath, line)
  return 1
}

module.exports = { appendLine }
