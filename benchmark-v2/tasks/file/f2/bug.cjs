// Task: updateJson(filePath, updates) reads the JSON file, applies the
// `updates` object as TOP-LEVEL key assignments, and writes the result back.
// Every key NOT mentioned in updates must survive untouched (including
// nested objects).

const fs = require('node:fs/promises')

async function updateJson(filePath, updates) {
  // BUGGY: writes only the updates — every other key in the file is lost.
  await fs.writeFile(filePath, JSON.stringify(updates, null, 2) + '\n')
}

module.exports = { updateJson }
