const { nextOccurrences } = require('./recurrence.js')

function expand(rule, fromISO, limit) {
  return nextOccurrences(rule, fromISO, limit).sort()
}
module.exports = { expand }
