function firstSuccess(promises) {
  return new Promise((resolve, reject) => {
    const reasons = []
    let pending = promises.length
    if (pending === 0) {
      reject(reasons)
      return
    }
    for (const promise of promises) {
      Promise.resolve(promise).then(resolve, (reason) => {
        reasons.push(reason)
        if (--pending === 0) reject(reasons)
      })
    }
  })
}
module.exports = { firstSuccess }
