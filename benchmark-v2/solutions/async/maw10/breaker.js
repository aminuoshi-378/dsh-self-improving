class CircuitBreaker {
  constructor(threshold, cooldownMs) {
    this.threshold = threshold
    this.cooldownMs = cooldownMs
    this.state = 'closed'
    this.failures = 0
    this.openedAt = 0
  }
  async call(fn) {
    if (this.state === 'open') {
      if (Date.now() - this.openedAt >= this.cooldownMs) this.state = 'half-open'
      else throw new Error('OPEN')
    }
    try {
      const v = await fn()
      this.failures = 0
      if (this.state === 'half-open') this.state = 'closed'
      return v
    } catch (e) {
      if (this.state === 'half-open') {
        this.state = 'open'
        this.openedAt = Date.now()
      } else {
        this.failures++
        if (this.failures >= this.threshold) {
          this.state = 'open'
          this.openedAt = Date.now()
        }
      }
      throw e
    }
  }
}
module.exports = { CircuitBreaker }
