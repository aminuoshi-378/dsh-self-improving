const { updateJson } = require('./bug.cjs')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f2-'))
  const file = path.join(dir, 'config.json')
  const fixture = { keep: 'a', nested: { x: 1 }, extra: true }
  fs.writeFileSync(file, JSON.stringify(fixture, null, 2))

  await updateJson(file, { keep: 'changed', newKey: 5 })

  const after = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (after.keep !== 'changed') throw new Error('updated key must be applied')
  if (after.newKey !== 5) throw new Error('new key must be added')
  if (!after.nested || after.nested.x !== 1) throw new Error('nested unknown key must survive')
  if (after.extra !== true) throw new Error('unknown top-level key must survive')

  console.log('PASS: updateJson merges updates and preserves unknown keys')
}

main().then(undefined, (error) => {
  console.error('FAIL:', error && error.message)
  process.exit(1)
})
