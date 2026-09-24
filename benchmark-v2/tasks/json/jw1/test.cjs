const { getPath } = require('./bug.cjs')

function eq(actual, expected, msg) {
  if (actual !== expected) {
    console.error(`FAIL ${msg}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
    process.exit(1)
  }
}

eq(getPath({ a: { b: [10, 20] } }, 'a.b.1'), 20, 'nested array index')
eq(getPath({ a: 1 }, 'a'), 1, 'top-level key')
eq(getPath({ a: { b: 1 } }, 'a.x.y'), undefined, 'missing intermediate is undefined, never a throw')
eq(getPath({}, 'z'), undefined, 'empty object')
eq(getPath({ a: null }, 'a.b'), undefined, 'null intermediate is undefined, never a throw')
console.log('PASS: getPath never throws and returns undefined for gaps')
