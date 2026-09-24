function isoWeekdayUtc(isoDateTime) { return new Date(isoDateTime).getUTCDay() }
module.exports = { isoWeekdayUtc }
