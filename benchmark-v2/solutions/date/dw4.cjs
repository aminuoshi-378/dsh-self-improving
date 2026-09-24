function sameDayUtc(a, b) {
  return new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10)
}
module.exports = { sameDayUtc }
