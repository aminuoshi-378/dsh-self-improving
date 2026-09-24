// Task: validate(value, schema) returns an array of error strings; an
// empty array means valid. Schema fields, all optional:
//   type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'
//         (arrays map to 'array', null maps to 'null', others follow typeof)
//   nullable: null is only accepted when true (default false)
//   required: object only; listed keys must exist (errors mention 'required')
//   properties: object only; validate each present listed key against its
//               sub-schema, prefixing errors with '<key>.'
//   items: array only; validate every element, prefixing with '[<i>].'
//   minItems: array only; length must be >= minItems
// Unlisted object keys are allowed; absent properties keys are skipped.

function validate(value, schema) {
  // BUGGY: no array/null handling, required ignored, no recursion.
  const errs = []
  if (typeof value !== schema.type) errs.push(`type: expected ${schema.type}`)
  return errs
}

module.exports = { validate }
