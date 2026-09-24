const { touchMtime } = require('./bug.cjs')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw7-'))
  const file = path.join(dir, 'a.txt')
  fs.writeFileSync(file, 'precious data')
  const target = Date.now() - 120_000
  const result = await touchMtime(file, target)
  if (!result.touched) throw new Error('must report touched')
  if (fs.readFileSync(file, 'utf8') !== 'precious data') throw new Error('content must survive the touch')
  const after = fs.statSync(file).mtimeMs
  if (Math.abs(after - target) > 5) throw new Error(`mtime must be ~${target}, got ${after}`)
  console.log('PASS: touchMtime changes mtime without touching content')
}
main().then(undefined, (error) => { console.error('FAIL:', error && error.message); process.exit(1) })
