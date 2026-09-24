const { atomicWrite } = require('./bug.cjs')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-'))
  const file = path.join(dir, 'target.txt')

  await atomicWrite(file, 'v1')
  if (fs.readFileSync(file, 'utf8') !== 'v1') throw new Error('first write must produce readable content')

  await atomicWrite(file, 'v2')
  if (fs.readFileSync(file, 'utf8') !== 'v2') throw new Error('second write must replace content')

  const entries = fs.readdirSync(dir)
  if (JSON.stringify(entries) !== JSON.stringify(['target.txt'])) {
    throw new Error(`directory must contain ONLY target.txt, got ${JSON.stringify(entries)}`)
  }

  console.log('PASS: atomicWrite replaces content and leaves no temp files')
}

main().then(undefined, (error) => {
  console.error('FAIL:', error && error.message)
  process.exit(1)
})
