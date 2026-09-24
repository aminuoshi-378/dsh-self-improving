// Task: formatUtc(epochMs) must format the instant as UTC 'YYYY-MM-DD HH:mm:ss'
// (zero-padded), using UTC getters — never local time.

function pad(n) {
  // BUGGY: no zero-padding at all.
  return String(n)
}

function formatUtc(epochMs) {
  const d = new Date(epochMs)
  // BUGGY: uses LOCAL getters, so on a UTC+8 machine hours are shifted by 8.
  return `${pad(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
    + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

module.exports = { formatUtc }
