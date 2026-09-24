// Task: sameDayUtc(a, b) tells whether two ISO DATE-TIMES fall on the SAME UTC
// calendar day.

function sameDayUtc(a, b) {
  // BUGGY: compares LOCAL calendar fields; instants in different UTC days can
  // share a local day.
  const da = new Date(a)
  const db = new Date(b)
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate()
}

module.exports = { sameDayUtc }
