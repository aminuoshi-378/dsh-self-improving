const { appendDedup } = require('./bug.cjs')
const { mkdtempSync, readFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
function eq(actual, expected, msg) {
  if (actual !== expected) {
    console.error(`FAIL ${msg}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
    process.exit(1)
  }
}
const dir = mkdtempSync(path.join(tmpdir(), 'fh2-'))
const f = path.join(dir, 'w.txt')
eq(appendDedup(f, 'n1', 2), true, 'create with explicit window 2')
eq(appendDedup(f, 'n1', 2), false, 'dup of head')
eq(appendDedup(f, 'n2', 2), true, 'second line')
eq(appendDedup(f, 'n1', 2), false, 'n1 still inside the [n1,n2] window')
eq(appendDedup(f, 'n3', 2), true, 'n3 appends')
eq(appendDedup(f, 'n2'), false, 'n2 inside default 3-window [n1,n2,n3]')
eq(appendDedup(f, 'n2', 1), true, 'window 1 sees only the [n3] tail')
eq(readFileSync(f, 'utf8'), 'n1\nn2\nn3\nn2', 'final content')
console.log('PASS: sliding window semantics (held-out)')
