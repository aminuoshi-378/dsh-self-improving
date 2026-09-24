// Task: touchMtime(file, isoMs) sets the file's mtime to the given epoch ms
// WITHOUT touching the content.

const fs = require('node:fs/promises')

async function touchMtime(file, epochMs) {
  // BUGGY: rewrites the file with empty content, destroying it.
  await fs.writeFile(file, '')
  return { touched: true }
}

module.exports = { touchMtime }
