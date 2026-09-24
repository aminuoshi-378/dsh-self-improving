// pipeline.js — staged data processing built on pool.js.
// test.cjs is the complete behavioral contract for this workspace.
const { mapLimit } = require('./pool.js')

async function runPipeline(stages, items) {
  // discarded), and errors carry no stage tag.
  const allErrors = []
  for (let s = 0; s < stages.length; s++) {
    const { results, errors } = await mapLimit(items, stages[s].concurrency, stages[s].fn)
    for (const e of errors) allErrors.push(e)
  }
  const last = stages.length ? await mapLimit(items, stages[stages.length - 1].concurrency, stages[stages.length - 1].fn) : { results: items.slice(), errors: [] }
  return { results: last.results, errors: allErrors }
}
module.exports = { runPipeline }
