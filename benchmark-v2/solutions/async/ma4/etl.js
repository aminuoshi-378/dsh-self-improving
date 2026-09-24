const { runPipeline } = require('./pipeline.js')

async function runETL(records, opts) {
  const stages = [
    { concurrency: opts.readConcurrency, fn: (r) => {
        if (typeof r.qty !== 'number' || typeof r.unitPrice !== 'number') throw new Error('bad record')
        return { id: r.id, total: r.qty * r.unitPrice }
      } },
    { concurrency: opts.computeConcurrency, fn: (r) => {
        const t = r.total * (1 - (r.discount ?? 0))
        if (t <= 0) throw new Error('non-positive total')
        return { id: r.id, total: t }
      } },
    { concurrency: 1, fn: (r) => ({ id: r.id, total: `${r.total.toFixed(2)} ok` }) },
  ]
  return runPipeline(stages, records)
}
module.exports = { runETL }
