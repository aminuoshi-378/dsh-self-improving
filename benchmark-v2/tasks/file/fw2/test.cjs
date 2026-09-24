const { readJson } = require('./bug.cjs')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw2-'))
  const good = path.join(dir, 'good.json')
  fs.writeFileSync(good, JSON.stringify({ a: 1 }))

  const parsed = await readJson(good, { def: true })
  if (parsed.a !== 1) throw new Error('valid file must parse')

  const missing = await readJson(path.join(dir, 'nope.json'), { def: true })
  if (missing.def !== true) throw new Error('missing file must return the fallback')

  const corrupt = path.join(dir, 'corrupt.json')
  fs.writeFileSync(corrupt, '{oops')
  const rescued = await readJson(corrupt, { def: true })
  if (rescued.def !== true) throw new Error('corrupt content must return the fallback')

  console.log('PASS: readJson never throws and falls back gracefully')
}

main().then(undefined, (error) => {
  console.error('FAIL:', error && error.message)
  process.exit(1)
})
