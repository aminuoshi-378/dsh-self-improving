// Task: groupBy(arr, key) groups objects by the value of `key` into arrays,
// preserving first-seen group order and item order within groups.

function groupBy(arr, key) {
  // BUGGY: overwrites — every group keeps only its LAST item.
  const out = {}
  for (const item of arr) out[item[key]] = item
  return out
}

module.exports = { groupBy }
