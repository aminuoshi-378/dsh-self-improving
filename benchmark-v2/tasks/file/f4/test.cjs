const { rotateBackup } = require('./bug.cjs')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-'))
  const file = path.join(dir, 'data.txt')

  const writeMain = (text) => fs.writeFileSync(file, text)
  const read = (p) => fs.readFileSync(p, 'utf8')

  writeMain('c0')
  await rotateBackup(file, 2)
  if (read(`${file}.1`) !== 'c0') throw new Error('first rotation puts c0 into .1')

  writeMain('c1')
  await rotateBackup(file, 2)
  if (read(`${file}.1`) !== 'c1' || read(`${file}.2`) !== 'c0') {
    throw new Error('second rotation shifts .1 -> .2 and main -> .1')
  }

  writeMain('c2')
  await rotateBackup(file, 2)
  if (read(`${file}.1`) !== 'c2' || read(`${file}.2`) !== 'c1') {
    throw new Error('third rotation keeps the latest two')
  }
  if (fs.existsSync(`${file}.3`)) {
    throw new Error('keep=2 must cap backups at file.2 — file.3 must not exist')
  }
  if (fs.existsSync(file)) {
    throw new Error('the main file is consumed by rotation (renamed to file.1)')
  }

  console.log('PASS: rotateBackup caps backups at `keep` and shifts correctly')
}

main().then(undefined, (error) => {
  console.error('FAIL:', error && error.message)
  process.exit(1)
})
