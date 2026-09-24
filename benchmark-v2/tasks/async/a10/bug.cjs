// Task: parallelMap(items, limit, fn) maps with AT MOST `limit` concurrent fn
// calls, keeps results in input order, and NEVER rejects: a failing slot
// becomes { error: <message> } at its position; results hold values elsewhere.

async function parallelMap(items, limit, fn) {
  // BUGGY: unlimited concurrency and a single failure rejects everything.
  return Promise.all(items.map((item, index) => fn(item, index)))
}

module.exports = { parallelMap }
