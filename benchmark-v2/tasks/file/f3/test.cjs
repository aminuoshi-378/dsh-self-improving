const { appendLine } = require('./bug.cjs')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f3-'))
  const file = path.join(dir, 'app.log')

  const count1 = await appendLine(file, 'first')
  if (count1 !== 1) throw new Error(`first append must report 1 line, got ${count1}`)
  if (fs.readFileSync(file, 'utf8') !== 'first\n') {
    throw new Error(`content must be 'first\\n', got ${JSON.stringify(fs.readFileSync(file, 'utf8'))}`)
  }

  const count2 = await appendLine(file, 'second')
  const content = fs.readFileSync(file, 'utf8')
  if (count2 !== 2) throw new Error(`second append must report 2 lines, got ${count2}`)
  if (content !== 'first\nsecond\n') {
    throw new Error(`existing lines must survive; got ${JSON.stringify(content)}`)
  }

  console.log('PASS: appendLine appends with newline and counts lines')
}

main().then(undefined, (error) => {
  console.error('FAIL:', error && error.message)
  process.exit(1)
})
