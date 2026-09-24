const { omit } = require('./bug.cjs')

function deepEq(actual, expected, msg) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL ${msg}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
    process.exit(1)
  }
}

const src = { a: 1, b: 2, c: 3 }
const result = omit(src, ['b'])
deepEq(result, { a: 1, c: 3 }, 'omitted key is gone')
deepEq(src, { a: 1, b: 2, c: 3 }, 'the original object is untouched')
deepEq(omit({ x: 1 }, []), { x: 1 }, 'empty key list is a no-op copy')
deepEq(omit({ x: 1 }, ['missing']), { x: 1 }, 'missing key is harmless')
console.log('PASS: omit copies without mutating the original')
