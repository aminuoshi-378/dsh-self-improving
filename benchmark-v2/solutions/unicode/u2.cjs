function truncate(str, n) {
  return Array.from(str).slice(0, n).join('')
}
module.exports = { truncate }
