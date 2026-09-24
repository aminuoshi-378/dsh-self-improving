const { writeIfChanged } = require('./bug.cjs')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw1-'))
  const file = path.join(dir, 'state.txt')

  const first = await writeIfChanged(file, 'v1')
  if (!first.changed || fs.readFileSync(file, 'utf8') !== 'v1') throw new Error('missing file: first write must change')

  const mtimeBefore = fs.statSync(file).mtimeMs
  const second = await writeIfChanged(file, 'v1')
  if (second.changed) throw new Error('identical content must report changed:false')
  if (fs.statSync(file).mtimeMs !== mtimeBefore) throw new Error('unchanged write must not touch mtime')

  const third = await writeIfChanged(file, 'v2')
  if (!third.changed || fs.readFileSync(file, 'utf8') !== 'v2') throw new Error('different content must be written')

  console.log('PASS: writeIfChanged skips identical writes')
}

main().then(undefined, (error) => {
  console.error('FAIL:', error && error.message)
  process.exit(1)
})
