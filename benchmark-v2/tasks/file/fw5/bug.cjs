// Task: appendJsonLine(file, obj) appends one JSON line (JSON.stringify + '\n');
// existing lines are preserved.

const fs = require('node:fs/promises')

async function appendJsonLine(file, obj) {
  // BUGGY: overwrites the whole file every call.
  await fs.writeFile(file, `${JSON.stringify(obj)}\n`)
}

module.exports = { appendJsonLine }
