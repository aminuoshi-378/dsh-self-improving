const { reverse } = require('./bug.cjs')

function eq(actual, expected, msg) {
  if (actual !== expected) {
    console.error(`FAIL ${msg}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
    process.exit(1)
  }
}

eq(reverse('abc'), 'cba', 'ascii')
eq(reverse('a\u{1F600}bc'), 'cb\u{1F600}a', 'emoji surrogate pair kept intact')
eq(reverse('\u{1F600}'), '\u{1F600}', 'single emoji')
eq(reverse('ab'), 'ba', 'two chars')
console.log('PASS: reverse handles ASCII and multi-byte Unicode')
