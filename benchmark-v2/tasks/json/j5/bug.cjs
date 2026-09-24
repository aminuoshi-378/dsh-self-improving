// Task: mergeDeep(a, b) deep-merges plain objects: b wins on conflicts, but
// nested keys from BOTH sides survive. Arrays are REPLACED, not merged.
// Neither input is mutated.

function mergeDeep(a, b) {
  // BUGGY: a shallow spread — nested objects from b replace a's entirely,
  // dropping a's sibling keys.
  return { ...a, ...b }
}

module.exports = { mergeDeep }
