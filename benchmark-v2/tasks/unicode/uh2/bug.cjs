// Task: groupVisual(arr) groups the input strings by visual identity: two
// strings share a group when they are NFC-equal after dropping the invisible
// characters U+200B, U+200C, U+200D and U+00AD (same rule as visual
// equality; case-sensitive). Groups keep first-appearance order of members,
// and the groups themselves keep first-appearance order. Returns an array of
// arrays.
// groupVisual(['a\u200Cb', 'ab', 'e\u0301', '\u00e9']) ->
//   [['a\u200Cb', 'ab'], ['e\u0301', '\u00e9']]

function groupVisual(arr) {
  // BUGGY: groups by raw string identity — visually equal spellings
  // land in separate groups.
  const groups = []
  for (const item of arr) {
    let group = groups.find((g) => g[0] === item)
    if (!group) { group = [item]; groups.push(group) }
    else group.push(item)
  }
  return groups
}

module.exports = { groupVisual }
