const { daysUntilUtc } = require('./bug.cjs')
function eq(a, b, m) { if (a !== b) { console.error(`FAIL ${m}: got ${a}, want ${b}`); process.exit(1) } }
eq(daysUntilUtc('2026-01-01', '2026-01-31'), 30, 'within a month')
eq(daysUntilUtc('2026-01-01', '2026-03-01'), 59, 'january to march is 59 days')
eq(daysUntilUtc('2026-09-22', '2026-09-22'), 0, 'same day')
eq(daysUntilUtc('2025-12-31', '2026-01-01'), 1, 'year boundary')
console.log('PASS: daysUntilUtc is exact UTC day math')
