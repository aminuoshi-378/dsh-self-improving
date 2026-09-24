const { removeIfEmpty } = require('./bug.cjs')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
async function main() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fw4-'))
  const empty = path.join(base, 'empty')
  fs.mkdirSync(empty)
  const gone = await removeIfEmpty(empty)
  if (!gone.removed || fs.existsSync(empty)) throw new Error('empty dir must be removed')

  const full = path.join(base, 'full')
  fs.mkdirSync(full)
  fs.writeFileSync(path.join(full, 'keep.txt'), 'data')
  const kept = await removeIfEmpty(full)
  if (kept.removed || !fs.existsSync(path.join(full, 'keep.txt'))) throw new Error('non-empty dir must survive with contents')
  console.log('PASS: removeIfEmpty only removes empty directories')
}
main().then(undefined, (error) => { console.error('FAIL:', error && error.message); process.exit(1) })
