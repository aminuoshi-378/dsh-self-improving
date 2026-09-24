// Task: uniqueByKey(arr, key) removes duplicates by key, keeping the FIRST
// occurrence and the original order.

function uniqueByKey(arr, key) {
  // BUGGY: keeps the LAST occurrence (Map overwrite).
  return [...new Map(arr.map((item) => [item[key], item])).values()]
}

module.exports = { uniqueByKey }
