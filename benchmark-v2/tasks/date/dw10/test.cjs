const { nextDayUtc } = require('./bug.cjs')
function eq(a, b, m) { if (a !== b) { console.error(`FAIL ${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); process.exit(1) } }
eq(nextDayUtc('2026-09-22'), '2026-09-23', 'plain next day')
eq(nextDayUtc('2026-09-30'), '2026-10-01', 'month rollover')
eq(nextDayUtc('2026-12-31'), '2027-01-01', 'year rollover')
eq(nextDayUtc('2026-02-28'), '2026-03-01', 'non-leap february')
console.log('PASS: nextDayUtc is pure UTC day arithmetic')
