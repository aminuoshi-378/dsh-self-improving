function typeOf(v) {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}
function validate(value, schema) {
  const errs = []
  if (value === null) {
    if (!schema.nullable) errs.push('null: not nullable')
    return errs
  }
  const t = typeOf(value)
  if (t !== schema.type) {
    errs.push(`type: expected ${schema.type}, got ${t}`)
    return errs
  }
  if (t === 'object') {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errs.push(`required: missing '${key}'`)
    }
    for (const [k, sub] of Object.entries(schema.properties ?? {})) {
      if (k in value) {
        for (const e of validate(value[k], sub)) errs.push(`${k}.${e}`)
      }
    }
  }
  if (t === 'array') {
    if (schema.items !== undefined) {
      value.forEach((el, i) => {
        for (const e of validate(el, schema.items)) errs.push(`[${i}].${e}`)
      })
    }
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errs.push(`minItems: ${value.length} < ${schema.minItems}`)
    }
  }
  return errs
}
module.exports = { validate }
