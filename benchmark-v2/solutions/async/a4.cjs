async function partition(work) {
  const settled = await Promise.allSettled(work)
  const fulfilled = []
  const rejected = []
  for (const entry of settled) {
    if (entry.status === 'fulfilled') fulfilled.push(entry.value)
    else rejected.push(entry.reason)
  }
  return { fulfilled, rejected }
}
module.exports = { partition }
