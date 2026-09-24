const { writeTextIfMissing } = require('./bug.cjs')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f7-'))
  const file = path.join(dir, 'cfg.json')
  const first = await writeTextIfMissing(file, 'v1')
  if (!first.written || fs.readFileSync(file, 'utf8') !== 'v1') throw new Error('missing file must be written')

  const mtime = fs.statSync(file).mtimeMs
  const second = await writeTextIfMissing(file, 'v2')
  if (second.written || fs.readFileSync(file, 'utf8') !== 'v1') throw new Error('existing file must not be overwritten')
  if (fs.statSync(file).mtimeMs !== mtime) throw new Error('existing file mtime must not churn')
  console.log('PASS: writeTextIfMissing leaves existing files alone')
}
main().then(undefined, (error) => { console.error('FAIL:', error && error.message); process.exit(1) })
