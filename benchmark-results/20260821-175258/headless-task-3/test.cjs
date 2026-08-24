const { removeDuplicates } = require('./bug.cjs')

const result = removeDuplicates([1, 2, 2, 3, 3, 3, 4])
const expected = [1, 2, 3, 4]

if (JSON.stringify(result) !== JSON.stringify(expected)) {
  console.error(`FAIL: removeDuplicates returned [${result}], expected [${expected}]`)
  process.exit(1)
}
console.log('PASS: removeDuplicates returns [1,2,3,4]')
