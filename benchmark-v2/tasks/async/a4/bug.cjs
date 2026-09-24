// Task: partition(work) takes an array of promises/values and NEVER rejects:
// it awaits ALL of them and returns { fulfilled: [values], rejected: [reasons] },
// both in original input order.

async function partition(work) {
  // BUGGY: fails fast on the first rejection and loses every other result.
  const results = await Promise.all(work)
  return { fulfilled: results, rejected: [] }
}

module.exports = { partition }
