function quarterStartUtc(isoDate) {
  const d = new Date(isoDate + 'T00:00:00Z')
  const month = Math.floor(d.getUTCMonth() / 3) * 3 + 1
  return d.toISOString().slice(0, 5) + String(month).padStart(2, '0') + '-01'
}
module.exports = { quarterStartUtc }
