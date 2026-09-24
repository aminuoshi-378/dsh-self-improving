function isoWeek(isoDate) {
  const d = new Date(isoDate + 'T00:00:00Z')
  const isoDow = ((d.getUTCDay() + 6) % 7) + 1
  const thursday = new Date(d)
  thursday.setUTCDate(d.getUTCDate() + (4 - isoDow))
  const year = thursday.getUTCFullYear()
  const jan1 = new Date(Date.UTC(year, 0, 1))
  const doy = Math.floor((thursday - jan1) / 86400000) + 1
  return { year, week: Math.floor((doy - 1) / 7) + 1 }
}
module.exports = { isoWeek }
