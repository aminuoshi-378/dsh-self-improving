// Task: isLeapYearUtc(year) — a leap year is divisible by 4, EXCEPT century
// years, which must be divisible by 400 (1900 is NOT a leap year, 2000 is).

function isLeapYearUtc(year) {
  // BUGGY: ignores the century rules.
  return year % 4 === 0
}

module.exports = { isLeapYearUtc }
