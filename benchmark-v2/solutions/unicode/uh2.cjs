function canonicalKey(s) {
  return s.normalize('NFC').replace(/[\u200B\u200C\u200D\u00AD]/g, '')
}
function groupVisual(arr) {
  const map = new Map()
  const groups = []
  for (const item of arr) {
    const key = canonicalKey(item)
    let group = map.get(key)
    if (group === undefined) { group = [item]; map.set(key, group); groups.push(group) }
    else group.push(item)
  }
  return groups
}
module.exports = { groupVisual }
