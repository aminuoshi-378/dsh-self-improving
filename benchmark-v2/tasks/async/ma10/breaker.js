// breaker.js — a circuit breaker guarding calls through one endpoint.
// test.cjs is the complete behavioral contract for this workspace.
class CircuitBreaker {
  constructor(threshold, cooldownMs) {
    this.threshold = threshold
    this.cooldownMs = cooldownMs
    this.state = 'closed'
    this.failures = 0
    this.openedAt = 0
  }
  async call(fn) {
    // stays half-open (never re-opens).
    if (this.state === 'open') {
      if (Date.now() - this.openedAt >= this.cooldownMs) this.state = 'half-open'
      else throw new Error('OPEN')
    }
    try {
      const v = await fn()
      this.state = 'closed'
      return v
    } catch (e) {
      this.failures++
      if (this.state === 'half-open') {
      } else if (this.failures >= this.threshold) {
        this.state = 'open'
        this.openedAt = Date.now()
      }
      throw e
    }
  }
}
module.exports = { CircuitBreaker }
