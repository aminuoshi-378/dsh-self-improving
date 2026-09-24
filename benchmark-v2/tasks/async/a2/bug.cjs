// Task: waterfall(steps) runs async steps SEQUENTIALLY: each step receives the
// previous step's result as its argument. It must stop at the first rejection,
// reject with that error, and never call later steps.

async function waterfall(steps) {
  // BUGGY: runs every step in parallel with no argument chaining.
  return Promise.all(steps.map((fn) => fn()))
}

module.exports = { waterfall }
