function countLeaves(node) {
  if (Array.isArray(node)) return node.reduce((sum, item) => sum + countLeaves(item), 0)
  if (node !== null && typeof node === 'object') {
    return Object.values(node).reduce((sum, value) => sum + countLeaves(value), 0)
  }
  return 1
}
module.exports = { countLeaves }
