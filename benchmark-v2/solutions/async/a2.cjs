async function waterfall(steps) {
  let value
  for (const fn of steps) value = await fn(value)
  return value
}
module.exports = { waterfall }
