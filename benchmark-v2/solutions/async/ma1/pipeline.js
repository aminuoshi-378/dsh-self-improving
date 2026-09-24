const { mapLimit } = require('./pool.js')

async function runPipeline(stages, items) {
  let current = items.slice()
  const allErrors = []
  for (let s = 0; s < stages.length; s++) {
    const stage = stages[s]
    const { results, errors } = await mapLimit(current, stage.concurrency, stage.fn)
    for (const e of errors) allErrors.push({ stage: s, ...e })
    current = results.filter((v) => v !== undefined)
  }
  return { results: current, errors: allErrors }
}
module.exports = { runPipeline }
