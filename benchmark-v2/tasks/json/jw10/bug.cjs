// Task: fromPairs(pairs) builds an object from [key, value] entries; when a
// key appears twice, the LAST value wins.

function fromPairs(pairs) {
  // BUGGY: keeps the FIRST occurrence via a has-check.
  const out = {}
  for (const [key, value] of pairs) {
    if (!(key in out)) out[key] = value
  }
  return out
}

module.exports = { fromPairs }
