const { nthCodePointValue } = require('./bug.cjs')

function eq(actual, expected, msg) {
  if (actual !== expected) {
    console.error(`FAIL ${msg}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
    process.exit(1)
  }
}

eq(nthCodePointValue('a\u{1F600}b', 1), 0x1F600, 'emoji code point value')
eq(nthCodePointValue('abc', 0), 97, 'ascii value')
eq(nthCodePointValue('a\u{1F600}b', 2), 98, 'index after emoji counts once')
eq(nthCodePointValue('ab', 9), undefined, 'out of range')
console.log('PASS: nthCodePointValue reads whole code points')
