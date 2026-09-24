async function withRetry(fn, opts = {}) {
  const retries = opts.retries ?? 2
  const shouldRetry = opts.shouldRetry ?? (() => true)
  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    try { return await fn() } catch (error) {
      lastError = error
      if (attempt === retries || !shouldRetry(error)) throw error
    }
  }
  throw lastError
}
module.exports = { withRetry }
