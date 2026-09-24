// Task: quarterStartUtc(isoDate) returns the FIRST day of the quarter that
// contains the given date, as 'YYYY-MM-01' (Jan-Apr-Jul-Oct starts, UTC).

function quarterStartUtc(isoDate) {
  // BUGGY: builds an UNPADDED month string from a LOCAL-parsed date.
  const d = new Date(isoDate + 'T00:00:00')
  const q = Math.floor((d.getMonth() + 1) / 3) + 1
  const month = (q - 1) * 3 + 1
  return d.getFullYear() + '-' + month + '-01'
}

module.exports = { quarterStartUtc }
