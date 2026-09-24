const { swapHalves } = require('./bug.cjs')

function eq(actual, expected, msg) {
  if (actual !== expected) {
    console.error(`FAIL ${msg}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
    process.exit(1)
  }
}

eq(swapHalves('abcd'), 'cdab', 'even ascii halves swap')
eq(swapHalves('ab'), 'ba', 'two chars')
eq(swapHalves('\u{1F600}ab'), 'ba\u{1F600}', 'odd: emoji first, middle stays, halves swap')
eq(swapHalves('a\u{1F600}b'), 'b\u{1F600}a', 'odd: emoji middle stays in place')
eq(swapHalves('x'), 'x', 'single char unchanged')
console.log('PASS: swapHalves works on code-point halves')
