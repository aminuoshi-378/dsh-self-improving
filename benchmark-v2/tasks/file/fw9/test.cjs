const { listDirs } = require('./bug.cjs')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
async function main() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fw9-'))
  fs.mkdirSync(path.join(base, 'zeta'))
  fs.mkdirSync(path.join(base, 'alpha'))
  fs.writeFileSync(path.join(base, 'file.txt'), 'x')
  const dirs = await listDirs(base)
  if (JSON.stringify(dirs) !== JSON.stringify(['alpha', 'zeta'])) throw new Error(`only sorted subdirs, got ${JSON.stringify(dirs)}`)
  console.log('PASS: listDirs returns sorted subdirectories only')
}
main().then(undefined, (error) => { console.error('FAIL:', error && error.message); process.exit(1) })
