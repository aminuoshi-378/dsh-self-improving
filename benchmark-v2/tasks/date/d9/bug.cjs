// Task: utcPartsFromEpoch(epochMs) returns [YYYY, MM, DD, HH, mm, ss] as
// ZERO-PADDED strings, all in UTC.

function utcPartsFromEpoch(epochMs) {
  // BUGGY: LOCAL getters — every field is shifted on non-UTC machines.
  const d = new Date(epochMs)
  return [String(d.getFullYear()), String(d.getMonth() + 1), String(d.getDate()), String(d.getHours()), String(d.getMinutes()), String(d.getSeconds())]
}

module.exports = { utcPartsFromEpoch }
