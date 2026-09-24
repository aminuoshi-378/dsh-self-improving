// Task: withRetry(fn, { retries, shouldRetry }) retries a rejecting fn ONLY
// while shouldRetry(error) is true, at most `retries` extra attempts; a
// success passes through; the last error propagates when attempts run out.

async function withRetry(fn, opts = {}) {
  const retries = opts.retries ?? 2
  // BUGGY: ignores shouldRetry and always burns all retries.
  for (let i = 0; i <= retries; i++) {
    try { return await fn() } catch { /* retry unconditionally */ }
  }
  throw new Error('retries exhausted')
}

module.exports = { withRetry }
