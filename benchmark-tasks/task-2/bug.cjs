// Task 2: Fix the null check in the greeting function
// greet(null) should return "Hello, stranger!"
// Currently it throws TypeError

function greet(name) {
  return "Hello, " + name.toUpperCase() + "!"
}

module.exports = { greet }
