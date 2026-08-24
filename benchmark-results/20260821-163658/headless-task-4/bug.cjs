// Task 4: Fix the async error handling
// fetchData should return data on success, throw on error
// Currently it returns undefined on error instead of throwing

async function fetchData(shouldFail) {
  try {
    if (shouldFail) {
      throw new Error('Network error')
    }
    return { status: 'ok', data: [1, 2, 3] }
  } catch (e) {
    console.log('Error caught:', e.message)
  }
}

module.exports = { fetchData }
