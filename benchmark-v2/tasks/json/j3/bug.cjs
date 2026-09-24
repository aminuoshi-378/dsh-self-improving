// Task: flatten(obj) converts nested objects AND arrays into one level of
// dot-separated keys. Array elements become numeric key segments:
// {a:{b:1}, c:[2,3], d:5} -> {'a.b':1, 'c.0':2, 'c.1':3, d:5}

function flatten(obj) {
  const out = {}
  for (const [key, value] of Object.entries(obj)) {
    // BUGGY: only objects are recursed; arrays are kept whole as a value.
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const [subKey, subValue] of Object.entries(flatten(value))) {
        out[`${key}.${subKey}`] = subValue
      }
    } else {
      out[key] = value
    }
  }
  return out
}

module.exports = { flatten }
