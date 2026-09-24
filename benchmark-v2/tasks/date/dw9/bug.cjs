// Task: monthOfUtc(isoDateTime) returns the UTC month as zero-padded 'YYYY-MM'.

function monthOfUtc(isoDateTime) {
  // BUGGY: LOCAL fields and no zero padding.
  const d = new Date(isoDateTime)
  return `${d.getFullYear()}-${d.getMonth() + 1}`
}

module.exports = { monthOfUtc }
