function monthOfUtc(isoDateTime) {
  const d = new Date(isoDateTime)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
module.exports = { monthOfUtc }
