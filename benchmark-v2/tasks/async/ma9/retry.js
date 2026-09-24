// retry.js — retry policy (stable spec).
// test.cjs is the complete behavioral contract for this workspace.
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
