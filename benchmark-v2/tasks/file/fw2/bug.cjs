// Task: readJson(filePath, fallback) parses a JSON file; when the file is
// missing OR the content is not valid JSON it returns `fallback` — it must
// never throw.

const fs = require('node:fs/promises')

async function readJson(filePath, fallback) {
  // BUGGY: raw JSON.parse — both missing files and corrupt content throw.
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

module.exports = { readJson }
