const { clampedAdd } = require('./core.js')

function nextOccurrences(rule, fromISO, count) {
  const out = []
  for (let i = 1; i <= count; i++) {
    if (rule.kind === 'DAILY' || rule.kind === 'WEEKLY') {
      const days = rule.step * (rule.kind === 'WEEKLY' ? 7 : 1) * i
      const d = new Date(fromISO + 'T00:00:00Z')
      d.setUTCDate(d.getUTCDate() + days)
      out.push(d.toISOString().slice(0, 10))
    } else {
      out.push(clampedAdd(fromISO, rule.step * i))
    }
  }
  return out
}
module.exports = { nextOccurrences }
