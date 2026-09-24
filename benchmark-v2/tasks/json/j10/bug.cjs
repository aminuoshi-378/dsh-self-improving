// Task: countLeaves(obj) counts primitive leaves; arrays contribute their
// element count; plain objects recurse.

function countLeaves(obj) {
  // BUGGY: counts only top-level keys.
  return Object.keys(obj).length
}

module.exports = { countLeaves }
