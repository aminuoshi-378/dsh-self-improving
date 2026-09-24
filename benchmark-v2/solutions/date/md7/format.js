const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatAbbr(iso) {
  const d = new Date(iso + 'T00:00:00Z')
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}
function formatDayNumber(iso) {
  const d = new Date(iso + 'T00:00:00Z')
  return Math.floor((d.getTime() - Date.UTC(1970, 0, 1)) / 86400000)
}
module.exports = { formatAbbr, formatDayNumber }
