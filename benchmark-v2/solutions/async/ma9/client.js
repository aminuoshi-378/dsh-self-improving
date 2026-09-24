const { retryWithBackoff } = require('./retry.js')
const { CircuitBreaker } = require('./breaker.js')

const breakers = new Map()

function breakerFor(name, opts) {
  if (!breakers.has(name)) breakers.set(name, new CircuitBreaker(opts.threshold ?? 2, opts.cooldownMs ?? 20))
  return breakers.get(name)
}

async function callEndpoint(name, fn, opts = {}) {
  const breaker = breakerFor(name, opts)
  return breaker.call(() => retryWithBackoff(fn, opts))
}
module.exports = { callEndpoint }
