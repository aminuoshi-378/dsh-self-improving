// calendar.js — schedule expansion on top of recurrence.js.
// test.cjs is the complete behavioral contract for this workspace.
const { nextOccurrences } = require('./recurrence.js')

function expand(rule, fromISO, limit) {
  // sorting.
  return nextOccurrences(rule, fromISO, limit + 1)
}
module.exports = { expand }
