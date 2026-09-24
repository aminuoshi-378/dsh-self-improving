const { getPath } = require('./bug.cjs')
function eq(actual, expected, msg) {
  if (actual !== expected) {
    console.error(`FAIL ${msg}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
    process.exit(1)
  }
}
const rows = { rows: [{ v: 1 }, { v: 2 }, { cols: [{ v: 9 }] }] }
eq(getPath(rows, 'rows[2].cols[0].v', 'M'), 9, 'four levels deep')
eq(getPath(rows, 'rows[1].v', 'M'), 2, 'two levels')
eq(getPath(rows, 'rows[3].v', 'M'), 'M', 'row index out of range')
eq(getPath(rows, 'rows[2].cols[1].v', 'M'), 'M', 'col index out of range')
eq(getPath(rows, 'rows.cols', 'M'), 'M', 'object step into array')
eq(getPath({ a: [[{ b: 'x' }]] }, 'a[0][0].b', 'M'), 'x', 'mixed nesting')
eq(getPath({ d: { e: { f: { g: 42 } } } }, 'd.e.f.g', 0), 42, 'deep dotted')
eq(getPath(rows, 'rows[2].cols[0]', 'M'), rows.rows[2].cols[0], 'array leaf returned whole')
eq(getPath(null, 'a', 'M'), 'M', 'null root')
console.log('PASS: deep path reads (held-out)')
