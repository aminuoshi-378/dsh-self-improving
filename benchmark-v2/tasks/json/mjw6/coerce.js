// coerce.js — raw string coercion (used by form.js before validation).
// test.cjs is the complete behavioral contract for this workspace.
function coerceValue(raw, type) {
  // like '3.5'.
  if (type === 'boolean') {
    if (raw === 'true' || raw === 'false' || raw === 'TRUE' || raw === '1' || raw === '0') {
      return { ok: true, value: raw === 'true' || raw === 'TRUE' || raw === '1' }
    }
    return { ok: false }
  }
  if (type === 'number') {
    if (/^-?(\d+\.?\d*)$/.test(raw)) return { ok: true, value: Number(raw) }
    return { ok: false }
  }
  if (type === 'string') return { ok: true, value: raw }
  return { ok: false }
}
module.exports = { coerceValue }
