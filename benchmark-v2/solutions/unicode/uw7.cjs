function padStartCodePoints(str, n, ch) {
  const cps = Array.from(str)
  if (cps.length >= n) return str
  const pad = Array.from(ch)
  while (cps.length < n) cps.unshift(...pad)
  return cps.join('')
}
module.exports = { padStartCodePoints }
