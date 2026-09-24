const { isoDateFromParts } = require('./bug.cjs')
function eq(a, b, m) { if (a !== b) { console.error(`FAIL ${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); process.exit(1) } }
eq(isoDateFromParts(2026, 9, 5), '2026-09-05', 'single digit month and day')
eq(isoDateFromParts(2026, 12, 31), '2026-12-31', 'double digits untouched')
eq(isoDateFromParts(2000, 1, 1), '2000-01-01', 'january first')
console.log('PASS: isoDateFromParts pads month and day')
