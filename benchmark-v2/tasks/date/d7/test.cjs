const { firstDayNextMonthUtc } = require('./bug.cjs')
function eq(a, b, m) { if (a !== b) { console.error(`FAIL ${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); process.exit(1) } }
eq(firstDayNextMonthUtc('2025-12-15'), '2026-01-01', 'december rolls to next year')
eq(firstDayNextMonthUtc('2026-09-22'), '2026-10-01', 'september')
eq(firstDayNextMonthUtc('2026-01-31'), '2026-02-01', 'january')
console.log('PASS: firstDayNextMonthUtc rolls years and pads months')
