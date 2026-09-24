const { readFileP } = require('./bug.cjs')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-'))
  const file = path.join(dir, 'data.txt')
  fs.writeFileSync(file, 'hello-bench')

  const data = await readFileP(file)
  if (String(data) !== 'hello-bench') throw new Error(`expected content, got ${String(data)}`)

  const missing = path.join(dir, 'nope.txt')
  let rejected = null
  try {
    await readFileP(missing)
  } catch (error) {
    rejected = error
  }
  if (!rejected) throw new Error('readFileP must reject on missing file')
  if (rejected.code !== 'ENOENT') throw new Error(`must reject with ENOENT, got ${rejected.code}`)

  console.log('PASS: readFileP resolves content and rejects with ENOENT')
}

main().then(undefined, (error) => {
  console.error('FAIL:', error && error.message)
  process.exit(1)
})
