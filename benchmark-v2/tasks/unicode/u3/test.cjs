const { countCodePoints } = require('./bug.cjs')

function eq(actual, expected, msg) {
  if (actual !== expected) {
    console.error(`FAIL ${msg}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
    process.exit(1)
  }
}

eq(countCodePoints('hello'), 5, 'ascii')
eq(countCodePoints('a\u{1F600}b'), 3, 'emoji is one code point')
eq(countCodePoints('\u{1F600}'), 1, 'single emoji')
eq(countCodePoints('\u4f60\u597d'), 2, 'bmp chinese chars')
eq(countCodePoints(''), 0, 'empty')
console.log('PASS: countCodePoints counts Unicode code points')
