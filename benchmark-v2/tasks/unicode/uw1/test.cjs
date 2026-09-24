const { lastCodePoint } = require('./bug.cjs')

function eq(actual, expected, msg) {
  if (actual !== expected) {
    console.error(`FAIL ${msg}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
    process.exit(1)
  }
}

eq(lastCodePoint('ab\u{1F600}'), '\u{1F600}', 'emoji last code point stays whole')
eq(lastCodePoint('hello'), 'o', 'ascii')
eq(lastCodePoint('a'), 'a', 'single char')
eq(lastCodePoint('\u4f60\u597d\u{1F600}'), '\u{1F600}', 'mixed bmp and emoji')
console.log('PASS: lastCodePoint returns the last code point intact')
