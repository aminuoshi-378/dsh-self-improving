function addMonthsUtc(isoDate, months) {
  const d = new Date(isoDate + 'T00:00:00Z')
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  const day = Math.min(d.getUTCDate(), lastDay)
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), day)).toISOString().slice(0, 10)
}
module.exports = { addMonthsUtc }
