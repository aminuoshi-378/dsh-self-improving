const { endOfMonthUtc } = require('./bug.cjs')
function eq(a, b, m) { if (a !== b) { console.error(`FAIL ${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); process.exit(1) } }
eq(endOfMonthUtc('2026-02-15'), '2026-02-28', 'non-leap february')
eq(endOfMonthUtc('2026-09-22'), '2026-09-30', 'september has 30 days')
eq(endOfMonthUtc('2024-02-01'), '2024-02-29', 'leap february')
eq(endOfMonthUtc('2026-12-31'), '2026-12-31', 'already the last day')
console.log('PASS: endOfMonthUtc uses real month lengths in UTC')
