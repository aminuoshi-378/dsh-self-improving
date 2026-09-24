function addBusinessDays(isoDate, n) {
  const d = new Date(isoDate + 'T00:00:00Z')
  const step = n >= 0 ? 1 : -1
  let remaining = Math.abs(n)
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + step)
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) remaining--
  }
  return d.toISOString().slice(0, 10)
}
module.exports = { addBusinessDays }
