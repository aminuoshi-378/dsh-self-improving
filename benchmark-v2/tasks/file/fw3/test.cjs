const { ensureDir } = require('./bug.cjs')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
async function main() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fw3-'))
  const target = path.join(base, 'a', 'b')
  const first = await ensureDir(target)
  if (!first.created || !fs.statSync(target).isDirectory()) throw new Error('missing chain must be created')
  const second = await ensureDir(target)
  if (second.created) throw new Error('existing dir must report created:false')
  console.log('PASS: ensureDir is idempotent and never throws')
}
main().then(undefined, (error) => { console.error('FAIL:', error && error.message); process.exit(1) })
