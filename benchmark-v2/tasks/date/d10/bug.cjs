// Task: isoDateFromParts(y, m, d) builds 'YYYY-MM-DD' with zero-padded month
// and day (inputs may be single digits).

function isoDateFromParts(y, m, d) {
  // BUGGY: no zero padding at all.
  return `${y}-${m}-${d}`
}

module.exports = { isoDateFromParts }
