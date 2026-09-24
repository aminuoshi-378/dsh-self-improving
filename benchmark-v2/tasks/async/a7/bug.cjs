// Task: retryUntil(fn, { maxAttempts, isDone }) calls fn up to maxAttempts and
// returns the FIRST result where isDone(result) is true; if none qualifies,
// returns the LAST result (fn never throws here).

async function retryUntil(fn, opts) {
  // BUGGY: never retries — returns the first result unconditionally.
  return fn()
}

module.exports = { retryUntil }
