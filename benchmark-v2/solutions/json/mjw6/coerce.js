function coerceValue(raw, type) {
  if (type === 'boolean') {
    if (raw === 'true') return { ok: true, value: true }
    if (raw === 'false') return { ok: true, value: false }
    return { ok: false }
  }
  if (type === 'number') {
    if (/^-?\d+$/.test(raw)) return { ok: true, value: Number(raw) }
    return { ok: false }
  }
  if (type === 'string') return { ok: true, value: raw }
  return { ok: false }
}
module.exports = { coerceValue }
