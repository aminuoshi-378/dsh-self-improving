// Task: pick(obj, keys) returns a copy holding ONLY the listed keys; the
// original object must never be mutated.

function pick(obj, keys) {
  // BUGGY: deletes unlisted keys directly on the input.
  const out = { ...obj }
  for (const key of Object.keys(obj)) {
    if (!keys.includes(key)) delete obj[key]
  }
  return out
}

module.exports = { pick }
