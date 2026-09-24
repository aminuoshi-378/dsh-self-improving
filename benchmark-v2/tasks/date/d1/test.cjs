const { formatUtc } = require('./bug.cjs')

function eq(actual, expected, msg) {
  if (actual !== expected) {
    console.error(`FAIL ${msg}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
    process.exit(1)
  }
}

eq(formatUtc(Date.UTC(2026, 8, 22, 5, 7, 9)), '2026-09-22 05:07:09', 'UTC fields with padding')
eq(formatUtc(Date.UTC(2026, 0, 3, 0, 0, 0)), '2026-01-03 00:00:00', 'single-digit fields are zero-padded')
eq(formatUtc(Date.UTC(2025, 11, 31, 23, 59, 59)), '2025-12-31 23:59:59', 'year boundary')
console.log('PASS: formatUtc renders UTC with zero padding')
