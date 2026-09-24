async function sequence(steps) {
  const results = []
  let value
  for (const step of steps) {
    value = await step(value)
    results.push(value)
  }
  return results
}
module.exports = { sequence }
