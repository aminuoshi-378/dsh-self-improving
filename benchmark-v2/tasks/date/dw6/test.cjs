const { isWeekendUtc } = require('./bug.cjs')
function eq(a, b, m) { if (a !== b) { console.error(`FAIL ${m}: got ${a}, want ${b}`); process.exit(1) } }
eq(isWeekendUtc('2026-09-25T20:00:00Z'), false, 'utc friday evening is not the weekend')
eq(isWeekendUtc('2026-09-26T10:00:00Z'), true, 'utc saturday')
eq(isWeekendUtc('2026-09-21T00:00:00Z'), false, 'utc monday')
eq(isWeekendUtc('2026-09-27T02:00:00Z'), true, 'utc sunday')
console.log('PASS: isWeekendUtc reads the UTC weekday')
