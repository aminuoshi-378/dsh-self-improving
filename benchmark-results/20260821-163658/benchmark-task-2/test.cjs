const { greet } = require('./bug.cjs')

const result1 = greet(null)
if (result1 !== 'Hello, stranger!') {
  console.error(`FAIL: greet(null) returned "${result1}", expected "Hello, stranger!"`)
  process.exit(1)
}

const result2 = greet('Alice')
if (result2 !== 'Hello, Alice!') {
  console.error(`FAIL: greet("Alice") returned "${result2}", expected "Hello, Alice!"`)
  process.exit(1)
}
console.log('PASS: greet handles null and named input')
