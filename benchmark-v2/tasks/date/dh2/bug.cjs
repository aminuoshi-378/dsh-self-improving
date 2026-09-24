// Task: addBusinessDays(isoDate, n) adds n UTC business days to a date,
// skipping Saturdays and Sundays. n may be negative or zero. The start date
// is position zero; step one UTC day at a time toward the target and do not
// count weekend days.
// addBusinessDays('2024-05-31', 3) -> '2024-06-05'   (Fri + 3 -> Wed)

function addBusinessDays(isoDate, n) {
  // BUGGY: adds raw calendar days, weekends included, and never walks
  // backward for negative n.
  const d = new Date(isoDate + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

module.exports = { addBusinessDays }
