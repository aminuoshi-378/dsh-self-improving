const { ellipsize } = require('./bug.cjs')

function eq(actual, expected, msg) {
  if (actual !== expected) {
    console.error(`FAIL ${msg}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
    process.exit(1)
  }
}

eq(ellipsize('abcde', 8), 'abcde', 'fits: unchanged')
eq(ellipsize('abcde', 3), 'abc\u2026', 'ascii truncate')
eq(ellipsize('\u4f60\u597d\u{1F600}\u4e16\u754c', 3), '\u4f60\u597d\u{1F600}\u2026', 'emoji counts once and stays whole')
eq(ellipsize('a\u{1F600}b', 2), 'a\u{1F600}\u2026', 'cut point never splits a surrogate pair')
console.log('PASS: ellipsize is code-point aware')
