const { addMonthsUtc } = require('./bug.cjs')
function eq(a, b, m) { if (a !== b) { console.error(`FAIL ${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); process.exit(1) } }
eq(addMonthsUtc('2026-01-31', 1), '2026-02-28', 'clamps jan 31 to feb 28')
eq(addMonthsUtc('2026-09-22', 1), '2026-10-22', 'plain month shift')
eq(addMonthsUtc('2026-12-15', 2), '2027-02-15', 'crosses the year')
eq(addMonthsUtc('2026-03-31', -1), '2026-02-28', 'negative shift clamps to feb')
console.log('PASS: addMonthsUtc clamps to month length in UTC')
