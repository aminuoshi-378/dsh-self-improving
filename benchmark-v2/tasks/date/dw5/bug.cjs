// Task: addMonthsUtc(isoDate, months) shifts the month by `months` (may be
// negative), CLAMPING the day to the target month's last day, UTC only.

function addMonthsUtc(isoDate, months) {
  // BUGGY: local setMonth auto-rolls overflow days into the next month and the
  // UTC readback shifts the date.
  const d = new Date(isoDate + 'T00:00:00')
  d.setMonth(d.getMonth() + months)
  return d.toISOString().slice(0, 10)
}

module.exports = { addMonthsUtc }
