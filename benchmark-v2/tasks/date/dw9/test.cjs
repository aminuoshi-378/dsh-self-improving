const { monthOfUtc } = require('./bug.cjs')
function eq(a, b, m) { if (a !== b) { console.error(`FAIL ${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); process.exit(1) } }
eq(monthOfUtc('2026-09-15T20:00:00Z'), '2026-09', 'utc september')
eq(monthOfUtc('2026-01-01T00:00:00Z'), '2026-01', 'january is padded')
eq(monthOfUtc('2025-12-31T23:00:00Z'), '2025-12', 'utc december')
console.log('PASS: monthOfUtc is padded and UTC')
