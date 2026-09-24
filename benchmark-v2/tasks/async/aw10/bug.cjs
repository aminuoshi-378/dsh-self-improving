// Task: allCounted(promises) NEVER rejects: it awaits everything and resolves
// with { fulfilled, rejected } counts.

async function allCounted(promises) {
  // BUGGY: Promise.all fails fast on the first rejection.
  const results = await Promise.all(promises)
  return { fulfilled: results.length, rejected: 0 }
}

module.exports = { allCounted }
