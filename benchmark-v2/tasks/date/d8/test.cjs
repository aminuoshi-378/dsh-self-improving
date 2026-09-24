const { daysInMonthUtc } = require('./bug.cjs')
function eq(a, b, m) { if (a !== b) { console.error(`FAIL ${m}: got ${a}, want ${b}`); process.exit(1) } }
eq(daysInMonthUtc('2026-02-15'), 28, 'non-leap february')
eq(daysInMonthUtc('2024-02-01'), 29, 'leap february')
eq(daysInMonthUtc('2026-09-30'), 30, 'september')
eq(daysInMonthUtc('2026-12-31'), 31, 'december')
console.log('PASS: daysInMonthUtc knows real month lengths')
