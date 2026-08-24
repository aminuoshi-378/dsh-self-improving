// Task 3: Fix the duplicate removal logic
// removeDuplicates should return unique values preserving order
// Currently it removes the first occurrence instead of keeping it

function removeDuplicates(arr) {
  const seen = {}
  return arr.filter(item => {
    if (seen[item]) {
      return true
    }
    seen[item] = true
    return false
  })
}

module.exports = { removeDuplicates }
