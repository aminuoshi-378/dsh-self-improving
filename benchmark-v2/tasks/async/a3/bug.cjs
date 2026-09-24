// Task: retry(fn, opts) calls fn up to opts.retries + 1 total attempts
// (the initial call plus retries). It resolves with the first success and
// REJECTS with the last error after all attempts fail. opts.baseMs doubles
// the wait between attempts (1ms, 2ms, 4ms, ...).

async function retry(fn, opts = {}) {
  const retries = opts.retries ?? 3
  // BUGGY: makes only `retries` total attempts (one too few) and swallows
  // the last error, resolving undefined instead of rejecting.
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (error) {
      // swallow
    }
  }
  return undefined
}

module.exports = { retry }
