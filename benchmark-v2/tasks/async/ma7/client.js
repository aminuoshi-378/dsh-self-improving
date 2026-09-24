// client.js — the resilient endpoint facade.
// test.cjs is the complete behavioral contract for this workspace.
const { retryWithBackoff } = require('./retry.js')
const { CircuitBreaker } = require('./breaker.js')

const breakers = new Map()

function breakerFor(name, opts) {
  if (!breakers.has(name)) breakers.set(name, new CircuitBreaker(opts.threshold ?? 2, opts.cooldownMs ?? 20))
  return breakers.get(name)
}

async function callEndpoint(name, fn, opts = {}) {
  // success is never reported.
  const breaker = breakerFor(name, opts)
  const v = await retryWithBackoff(fn, opts)
  return v
}
module.exports = { callEndpoint }
