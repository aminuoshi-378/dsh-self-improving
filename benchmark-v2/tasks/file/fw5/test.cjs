const { appendJsonLine } = require('./bug.cjs')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw5-'))
  const file = path.join(dir, 'log.jsonl')
  await appendJsonLine(file, { n: 1 })
  await appendJsonLine(file, { n: 2 })
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  if (JSON.stringify(lines) !== JSON.stringify([{ n: 1 }, { n: 2 }])) throw new Error(`both lines must survive: ${JSON.stringify(lines)}`)
  console.log('PASS: appendJsonLine preserves earlier lines')
}
main().then(undefined, (error) => { console.error('FAIL:', error && error.message); process.exit(1) })
