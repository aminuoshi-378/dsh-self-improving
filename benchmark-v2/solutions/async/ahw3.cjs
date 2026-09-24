function createQueue(concurrency) {
  let active = 0
  const pending = []
  const next = () => {
    if (active >= concurrency || pending.length === 0) return
    active++
    const task = pending.shift()
    Promise.resolve().then(task.fn).then(
      (v) => { active--; task.resolve(v); next() },
      (e) => { active--; task.reject(e); next() },
    )
  }
  return {
    push(fn) {
      return new Promise((resolve, reject) => {
        pending.push({ fn, resolve, reject })
        next()
      })
    },
    size() { return active + pending.length },
  }
}
module.exports = { createQueue }
