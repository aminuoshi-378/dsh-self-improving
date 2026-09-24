const { sameDayUtc } = require('./bug.cjs')
function eq(a, b, m) { if (a !== b) { console.error(`FAIL ${m}: got ${a}, want ${b}`); process.exit(1) } }
eq(sameDayUtc('2026-09-15T20:00:00Z', '2026-09-16T02:00:00Z'), false, 'different UTC days')
eq(sameDayUtc('2026-09-15T01:00:00Z', '2026-09-15T23:00:00Z'), true, 'same UTC day')
eq(sameDayUtc('2026-01-01T00:00:00Z', '2026-01-01T18:00:00Z'), true, 'year start')
eq(sameDayUtc('2025-12-31T23:00:00Z', '2026-01-01T00:30:00Z'), false, 'year boundary')
console.log('PASS: sameDayUtc compares UTC days')
