const { displayWidth, padTo } = require('./bug.cjs')
function eq(actual, expected, msg) {
  if (actual !== expected) {
    console.error(`FAIL ${msg}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
    process.exit(1)
  }
}
eq(displayWidth('a\uD55C'), 3, 'mixed width')
eq(displayWidth('e\u0301'), 1, 'mark counts 0')
eq(displayWidth('\u{1F600}'), 2, 'emoji wide')
eq(padTo('ab', 4), 'ab  ', 'pad ascii to 4')
eq(padTo('\uD55C', 4), '\uD55C  ', 'wide char pad by display width')
eq(padTo('\uD55C', 2), '\uD55C', 'exact width unchanged')
eq(padTo('abcd', 2), 'abcd', 'too long unchanged')
eq(padTo('e\u0301', 3), 'e\u0301  ', 'mark width 1 pads 2 spaces')
eq(padTo('', 2), '  ', 'empty pad')
eq(padTo('a\u200C\u200Db', 3), 'a\u200C\u200Db ', 'invisible chars count 0, pad 1')
console.log('PASS: display width and padding (held-out)')
