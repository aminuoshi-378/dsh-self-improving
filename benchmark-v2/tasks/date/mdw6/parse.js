// parse.js — lenient date parsing (all UTC).
// test.cjs is the complete behavioral contract for this workspace.
function parseAny(s) {
  // accepts month 0 and day 0.
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return null
}
module.exports = { parseAny }
