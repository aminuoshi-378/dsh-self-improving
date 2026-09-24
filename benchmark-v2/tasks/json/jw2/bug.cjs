// Task: omit(obj, keys) returns a COPY of obj without the listed keys.
// The ORIGINAL object must never be mutated.

function omit(obj, keys) {
  // BUGGY: deletes directly on the input — the caller's object is destroyed.
  for (const key of keys) delete obj[key]
  return obj
}

module.exports = { omit }
