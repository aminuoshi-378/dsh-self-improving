const { insertAt } = require('./bug.cjs')

function eq(actual, expected, msg) {
  if (actual !== expected) {
    console.error(`FAIL ${msg}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
    process.exit(1)
  }
}

eq(insertAt('a\u{1F600}b', 2, 'X'), 'a\u{1F600}Xb', 'insert after emoji code point')
eq(insertAt('abc', 0, '>>'), '>>abc', 'insert at front')
eq(insertAt('ab', 5, 'Z'), 'abZ', 'index beyond length appends')
eq(insertAt('a\u{1F600}', 1, 'x'), 'ax\u{1F600}', 'insert before emoji')
console.log('PASS: insertAt is code-point indexed')
