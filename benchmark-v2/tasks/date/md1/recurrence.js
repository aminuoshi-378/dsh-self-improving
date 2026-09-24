// recurrence.js — recurring date expansion (built on core.js).
// test.cjs is the complete behavioral contract for this workspace.
const { clampedAdd } = require('./core.js')

function nextOccurrences(rule, fromISO, count) {
  const out = []
  const daysOf = (iso, n) => {
    const d = new Date(iso + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() + n)
    return d.toISOString().slice(0, 10)
  }
  for (let i = 1; i <= count; i++) {
    if (rule.kind === 'DAILY') out.push(daysOf(fromISO, rule.step * i))
    else if (rule.kind === 'WEEKLY') out.push(daysOf(fromISO, rule.step * 7 * i))
    else out.push(daysOf(fromISO, rule.step * 30 * i))
  }
  return out
}
module.exports = { nextOccurrences }
