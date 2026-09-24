const { isLeapYearUtc } = require('./bug.cjs')

function eq(actual, expected, msg) {
  if (actual !== expected) {
    console.error(`FAIL ${msg}: got ${actual}, want ${expected}`)
    process.exit(1)
  }
}

eq(isLeapYearUtc(2024), true, '2024 is a leap year')
eq(isLeapYearUtc(2026), false, '2026 is not')
eq(isLeapYearUtc(1900), false, '1900: century not divisible by 400')
eq(isLeapYearUtc(2000), true, '2000: century divisible by 400')
eq(isLeapYearUtc(2100), false, '2100: century not divisible by 400')
console.log('PASS: isLeapYearUtc applies the full Gregorian rule')
