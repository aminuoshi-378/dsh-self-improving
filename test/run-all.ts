/**
 * Test runner — runs all test files sequentially.
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const testFiles = [
  'experience-store.test.ts',
  'outcome-evaluator.test.ts',
  'behavior-adapter.test.ts',
  'meta-cognition.test.ts',
  'memory-benchmark.test.ts',
]

let totalPassed = 0
let totalFailed = 0

for (const file of testFiles) {
  const filePath = join(__dirname, file)
  await new Promise<void>((resolve) => {
    const child = spawn('npx', ['tsx', filePath], {
      stdio: 'inherit',
      shell: true,
    })
    child.on('close', () => {
      resolve()
    })
    child.on('error', () => {
      resolve()
    })
  })
}

console.log('\n========================================')
console.log('All tests complete.')
console.log('========================================\n')
