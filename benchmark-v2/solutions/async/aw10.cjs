async function allCounted(promises) {
  const settled = await Promise.allSettled(promises)
  return {
    fulfilled: settled.filter((s) => s.status === 'fulfilled').length,
    rejected: settled.filter((s) => s.status === 'rejected').length,
  }
}
module.exports = { allCounted }
