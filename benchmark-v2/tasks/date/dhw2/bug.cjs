// Task: addBusinessDays(isoDate, n) adds n UTC business days to a date,
// skipping Saturdays and Sundays. n may be negative or zero. The start date
// is position zero; step one UTC day at a time toward the target and do not
// count weekend days.
// addBusinessDays('2024-06-07', 1) -> '2024-06-10'   (Friday + 1 -> Monday)
// addBusinessDays('2024-06-08', 1) -> '2024-06-10'   (Saturday + 1 -> Monday)

function addBusinessDays(isoDate, n) {
  // BUGGY: adds raw calendar days, weekends included.
  const d = new Date(isoDate + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

module.exports = { addBusinessDays }
