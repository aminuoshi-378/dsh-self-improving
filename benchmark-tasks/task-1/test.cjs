const { range } = require('./bug.cjs')

const result = range(5)
const expected = [1, 2, 3, 4, 5]

if (JSON.stringify(result) !== JSON.stringify(expected)) {
  console.error(`FAIL: range(5) returned [${result}], expected [${expected}]`)
  process.exit(1)
}
console.log('PASS: range(5) returns [1,2,3,4,5]')
