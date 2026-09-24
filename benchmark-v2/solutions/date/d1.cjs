function pad(n) {
  return String(n).padStart(2, '0')
}
function formatUtc(epochMs) {
  const d = new Date(epochMs)
  return `${pad(d.getUTCFullYear())}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} `
    + `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}
module.exports = { formatUtc }
