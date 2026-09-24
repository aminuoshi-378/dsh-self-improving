// etl.js — the fixed extract/transform/load pipeline built on pipeline.js.
// test.cjs is the complete behavioral contract for this workspace.
const { runPipeline } = require('./pipeline.js')

async function runETL(records, opts) {
  // load uses computeConcurrency instead of 1.
  const stages = [
    { concurrency: opts.readConcurrency, fn: (r) => {
        if (typeof r.qty !== 'number' || typeof r.unitPrice !== 'number') throw new Error('bad record')
        return { id: r.id, total: r.qty * r.unitPrice }
      } },
    { concurrency: opts.computeConcurrency, fn: (r) => {
        const t = r.qty * r.unitPrice * (1 - (r.discount ?? 0))
        if (t <= 0) throw new Error('non-positive total')
        return { id: r.id, total: t }
      } },
    { concurrency: opts.computeConcurrency, fn: (r) => ({ id: r.id, total: `${r.total.toFixed(2)} ok` }) },
  ]
  return runPipeline(stages, records)
}
module.exports = { runETL }
