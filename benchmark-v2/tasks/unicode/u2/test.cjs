const { truncate } = require('./bug.cjs')

function eq(actual, expected, msg) {
  if (actual !== expected) {
    console.error(`FAIL ${msg}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
    process.exit(1)
  }
}

eq(truncate('abcdef', 3), 'abc', 'ascii')
eq(truncate('ab', 5), 'ab', 'short string untouched')
eq(truncate('a\u{1F600}bc', 3), 'a\u{1F600}b', 'emoji is one code point')
eq(truncate('\u{1F600}\u{1F600}\u{1F600}', 2), '\u{1F600}\u{1F600}', 'emoji only')
console.log('PASS: truncate counts code points, never cuts surrogate pairs')
