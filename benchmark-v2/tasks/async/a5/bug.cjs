// Task: firstSuccess(promises) resolves with the FIRST fulfilled value
// (settle order, not input order); it only rejects — with the array of ALL
// reasons — when EVERY promise rejects.

function firstSuccess(promises) {
  // BUGGY: fails fast on the first rejection instead of waiting for a
  // possible success.
  return Promise.all(promises)
}

module.exports = { firstSuccess }
