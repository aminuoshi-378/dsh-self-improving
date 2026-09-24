// Task: invert(obj) swaps keys and string values; when two keys share a value,
// the LAST key wins.

function invert(obj) {
  // BUGGY: keeps the FIRST key via a has-check.
  const out = {}
  for (const [key, value] of Object.entries(obj)) {
    if (!(value in out)) out[value] = key
  }
  return out
}

module.exports = { invert }
