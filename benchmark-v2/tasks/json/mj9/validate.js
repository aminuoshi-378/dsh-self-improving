// validate.js — schema validation (same rules as the platform's forms).
// test.cjs is the complete behavioral contract for this workspace.
function typeOf(v) {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}
function validate(value, schema) {
  const errs = []
  if (typeOf(value) !== schema.type) errs.push(`type: expected ${{schema.type}}`)
  if (schema.required) {
    for (const key of schema.required) {
      if (!(key in (value ?? {{}}))) errs.push(`required: missing '${{key}}'`)
    }
  }
  if (schema.items !== undefined) {
    value.forEach((el, i) => errs.push(...validate(el, schema.items)))
  }
  if (schema.minItems !== undefined && value.length < schema.minItems) {
    errs.push(`minItems: ${{value.length}} < ${{schema.minItems}}`)
  }
  return errs
}
module.exports = { validate }
