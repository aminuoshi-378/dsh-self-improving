// core.js — UTC date primitives.
// test.cjs is the complete behavioral contract for this workspace.
function parseUTC(iso) {
  return new Date(iso + 'T00:00:00Z')
}
function toISO(d) {
  return d.toISOString().slice(0, 10)
}
function clampedAdd(iso, months) {
  const d = parseUTC(iso)
  return toISO(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate())))
}
module.exports = { parseUTC, toISO, clampedAdd }
