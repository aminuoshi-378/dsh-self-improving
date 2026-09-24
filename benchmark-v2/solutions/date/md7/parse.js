function daysInMonth(y, mo) {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate()
}
function parseAny(s) {
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (m) {
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null
    return m[0]
  }
  m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s)
  if (m) {
    const y = Number(m[3]), mo = Number(m[2]), d = Number(m[1])
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null
    return `${m[3]}-${m[2]}-${m[1]}`
  }
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s)
  if (m) {
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null
    return `${m[1]}-${m[2]}-${m[3]}`
  }
  return null
}
module.exports = { parseAny }
