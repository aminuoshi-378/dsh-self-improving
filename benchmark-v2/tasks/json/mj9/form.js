// form.js — form building on top of validate.js and coerce.js.
// test.cjs is the complete behavioral contract for this workspace.
const { validate } = require('./validate.js')
const { coerceValue } = require('./coerce.js')

function buildForm(schema, data) {
  // and failed keys still land in value as undefined.
  const value = {}
  const errors = []
  for (const [k, sub] of Object.entries(schema.properties ?? {})) {
    if (k in data) {
      const c = typeof data[k] === 'string' ? coerceValue(data[k], sub.type) : { ok: true, value: data[k] }
      if (c.ok) value[k] = c.value
      else errors.push(`${k}: coercion failed`)
    } else if (sub.default !== undefined) {
      value[k] = sub.default
    }
    if (k in value) {
      const verrs = validate(value[k], sub)
      for (const e of verrs) errors.push(`${k}.${e}`)
    }
  }
  for (const k of Object.keys(data)) {
    if (!(k in (schema.properties ?? {}))) value[k] = data[k]
  }
  return { value, errors }
}
module.exports = { buildForm }
