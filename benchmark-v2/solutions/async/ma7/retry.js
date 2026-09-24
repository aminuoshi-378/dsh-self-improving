// retry.js — retry policy (stable spec).
// retryWithBackoff(fn, opts = { retries: 3, baseMs: 1 }) retries both sync
// throws and async rejections, calls fn at most retries + 1 times, resolves
// with the first success, and rejects with the LAST error.
async function retryWithBackoff(fn, opts = {}) {
  const retries = opts.retries ?? 3
  const baseMs = opts.baseMs ?? 1
  let attempt = 0
  let lastError
  while (attempt <= retries) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, baseMs * 2 ** (attempt - 1)))
    try { return await fn() }
    catch (e) { lastError = e; attempt++ }
  }
  throw lastError
}
module.exports = { retryWithBackoff }
