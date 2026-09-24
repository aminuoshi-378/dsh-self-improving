const { validate } = require('./validate.js')
const { coerceValue } = require('./coerce.js')

function buildForm(schema, data) {
  const value = {}
  const errors = []
  for (const [k, sub] of Object.entries(schema.properties ?? {})) {
    let candidate
    if (k in data) {
      if (typeof data[k] === 'string' && (sub.type === 'boolean' || sub.type === 'number')) {
        const c = coerceValue(data[k], sub.type)
        if (!c.ok) { errors.push(`${k}: coercion failed`); continue }
        candidate = c.value
      } else {
        candidate = data[k]
      }
    } else if (sub.default !== undefined) {
      candidate = sub.default
    } else {
      if ((sub.required ?? (schema.required ?? []).includes(k))) errors.push(`${k}.required: missing '${k}'`)
      continue
    }
    const verrs = validate(candidate, sub)
    if (verrs.length > 0) {
      for (const e of verrs) errors.push(`${k}.${e}`)
      continue
    }
    value[k] = candidate
  }
  return { value, errors }
}
module.exports = { buildForm }
