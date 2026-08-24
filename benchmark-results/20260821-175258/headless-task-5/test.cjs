const { reverse } = require('./bug.cjs')

// Test ASCII
let result = reverse('hello')
if (result !== 'olleh') {
  console.error(`FAIL: reverse("hello") = "${result}", expected "olleh"`)
  process.exit(1)
}

// Test multi-byte Unicode (emoji)
result = reverse('abc😀def')
const expected = 'fed😀cba'
if (result !== expected) {
  console.error(`FAIL: reverse("abc😀def") = "${result}", expected "${expected}"`)
  process.exit(1)
}
console.log('PASS: reverse handles ASCII and multi-byte Unicode')
