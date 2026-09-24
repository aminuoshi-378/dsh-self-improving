const { listJson } = require('./bug.cjs')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f5-'))
  fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ x: 1 }))
  fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify({ y: 2 }))
  fs.writeFileSync(path.join(dir, 'readme.txt'), 'just some text, not JSON')
  fs.writeFileSync(path.join(dir, 'broken.json'), 'not valid json at all')

  const result = await listJson(dir)
  const expected = JSON.stringify({ a: { x: 1 }, b: { y: 2 } })
  if (JSON.stringify(result) !== expected) {
    throw new Error(`got ${JSON.stringify(result)}, want ${expected}`)
  }
  console.log('PASS: listJson collects parseable .json files only')
}

main().then(undefined, (error) => {
  console.error('FAIL:', error && error.message)
  process.exit(1)
})
