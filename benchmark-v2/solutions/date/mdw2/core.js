function parseUTC(iso) {
  return new Date(iso + 'T00:00:00Z')
}
function toISO(d) {
  return d.toISOString().slice(0, 10)
}
function clampedAdd(iso, months) {
  const d = parseUTC(iso)
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1))
  const dim = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  return toISO(new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d.getUTCDate(), dim))))
}
module.exports = { parseUTC, toISO, clampedAdd }
