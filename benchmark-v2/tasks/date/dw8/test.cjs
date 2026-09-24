const { isoWeekdayUtc } = require('./bug.cjs')
function eq(a, b, m) { if (a !== b) { console.error(`FAIL ${m}: got ${a}, want ${b}`); process.exit(1) } }
eq(isoWeekdayUtc('2026-09-21T20:00:00Z'), 1, 'utc monday evening')
eq(isoWeekdayUtc('2026-09-22T05:00:00Z'), 2, 'utc tuesday')
eq(isoWeekdayUtc('2026-09-26T23:00:00Z'), 6, 'utc saturday')
eq(isoWeekdayUtc('2026-09-27T00:30:00Z'), 0, 'utc sunday')
console.log('PASS: isoWeekdayUtc reads the UTC weekday')
