// Task: memoizeAsync(fn) caches results BY THE FIRST ARGUMENT: concurrent
// calls with the same argument share one execution; different arguments run
// separately; a REJECTION is never cached (the next call retries).

function memoizeAsync(fn) {
  // BUGGY: one unkeyed slot — every caller after the first gets the first
  // argument's result.
  let cached = null
  return async function memoized(arg) {
    if (!cached) cached = fn(arg)
    return cached
  }
}

module.exports = { memoizeAsync }
