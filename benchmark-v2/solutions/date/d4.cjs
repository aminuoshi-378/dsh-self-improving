function nextMondayUtc(isoDate) {
  const d = new Date(isoDate + 'T00:00:00Z')
  const day = d.getUTCDay()
  const delta = day === 1 ? 7 : (8 - day) % 7
  return new Date(d.getTime() + delta * 86400000).toISOString().slice(0, 10)
}
module.exports = { nextMondayUtc }
