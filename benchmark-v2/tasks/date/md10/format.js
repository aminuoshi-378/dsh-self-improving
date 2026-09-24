// format.js — date rendering (UTC).
// test.cjs is the complete behavioral contract for this workspace.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec']

function formatAbbr(iso) {
  const d = new Date(iso + 'T00:00:00Z')
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}
function formatDayNumber(iso) {
  const d = new Date(iso)
  return Math.floor((d.getTime() - new Date(1970, 0, 1)) / 86400000)
}
module.exports = { formatAbbr, formatDayNumber }
