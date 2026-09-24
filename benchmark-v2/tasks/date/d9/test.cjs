const { utcPartsFromEpoch } = require('./bug.cjs')
function deepEq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error(`FAIL ${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); process.exit(1) } }
deepEq(utcPartsFromEpoch(Date.UTC(2026, 8, 22, 5, 7, 9)), ['2026', '09', '22', '05', '07', '09'], 'all fields padded and utc')
deepEq(utcPartsFromEpoch(Date.UTC(2026, 0, 3, 0, 0, 0)), ['2026', '01', '03', '00', '00', '00'], 'midnight and single digits')
deepEq(utcPartsFromEpoch(Date.UTC(2025, 11, 31, 23, 59, 59)), ['2025', '12', '31', '23', '59', '59'], 'year end')
console.log('PASS: utcPartsFromEpoch is padded UTC')
