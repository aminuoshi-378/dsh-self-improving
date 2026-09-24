// Task: listJson(dir) reads every *.json file directly inside dir
// (non-recursive) and returns { <basename>: parsedValue }. Non-JSON files
// are ignored, and a file that fails to parse is SKIPPED (never fatal).

const fs = require('node:fs/promises')

async function listJson(dir) {
  const out = {}
  // BUGGY: reads every file (including non-JSON) with raw JSON.parse — a
  // single stray text file or broken JSON crashes the whole call.
  for (const name of await fs.readdir(dir)) {
    out[name.replace(/\.json$/, '')] = JSON.parse(await fs.readFile(`${dir}/${name}`, 'utf8'))
  }
  return out
}

module.exports = { listJson }
