async function retry(fn, opts = {}) {
  const retries = opts.retries ?? 3
  const baseMs = opts.baseMs ?? 1
  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, baseMs * 2 ** (attempt - 1)))
    try {
      return await fn()
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}
module.exports = { retry }
