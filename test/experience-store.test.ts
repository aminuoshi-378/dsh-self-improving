/**
 * Experience Store tests — Layer 3
 */

import { ExperienceStore } from '../src/store/experience-store.js'
import type { TurnOutcome } from '../src/types/index.js'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`)
}

function assertClose(actual: number, expected: number, tolerance: number, message: string): void {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`ASSERT FAILED: ${message} (expected ${expected}, got ${actual})`)
  }
}

let passed = 0
let failed = 0

function test(name: string, fn: () => void): void {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed++
    console.error(`  ✗ ${name}`)
    console.error(`    ${(err as Error).message}`)
  }
}

console.log('\n=== Experience Store Tests ===')

// ---------------------------------------------------------------------------
// Test 1: Store and retrieve a single record
// ---------------------------------------------------------------------------

test('store and retrieve a single record', () => {
  const store = new ExperienceStore()

  const outcome: TurnOutcome = {
    turnId: 'turn-1',
    sessionId: 'session-1',
    goalProgress: 'advanced',
    toolCallCount: 3,
    toolSuccessRate: 1.0,
    guardTriggerCount: 0,
    userFeedback: 'positive',
    outcomeScore: 0.95,
    timestamp: Date.now(),
  }

  const id = store.store(outcome, {
    taskPattern: 'refactoring',
    toolsUsed: ['read_file', 'edit_file'],
    workspaceDigest: 'abc123',
    actions: JSON.stringify({ tools: [], guards: [] }),
  })

  assert(id.length > 0, 'should return a non-empty id')
  assert(store.count() === 1, 'should have 1 record')

  const rec = store.getById(id)
  assert(rec !== null, 'should retrieve the record')
  assert(rec!.turnId === 'turn-1', 'turnId should match')
  assert(rec!.taskPattern === 'refactoring', 'taskPattern should match')
  assert(rec!.outcomeScore === 0.95, 'outcomeScore should match')
  assert(rec!.confidence === 1.0, 'confidence should start at 1.0')
  assert(rec!.reuseCount === 0, 'reuseCount should start at 0')

  store.close()
})

// ---------------------------------------------------------------------------
// Test 2: Query by task pattern
// ---------------------------------------------------------------------------

test('query by task pattern', () => {
  const store = new ExperienceStore()

  for (let i = 0; i < 5; i++) {
    store.store(
      {
        turnId: `turn-${i}`,
        sessionId: 'session-1',
        goalProgress: 'advanced',
        toolCallCount: 2,
        toolSuccessRate: 0.8,
        guardTriggerCount: 0,
        userFeedback: 'positive',
        outcomeScore: 0.8,
        timestamp: Date.now() + i,
      },
      {
        taskPattern: 'bugfix',
        toolsUsed: ['grep', 'read_file'],
        workspaceDigest: 'digest-1',
        actions: '{}',
      },
    )
  }

  for (let i = 0; i < 3; i++) {
    store.store(
      {
        turnId: `turn-f-${i}`,
        sessionId: 'session-2',
        goalProgress: 'stalled',
        toolCallCount: 4,
        toolSuccessRate: 0.25,
        guardTriggerCount: 2,
        userFeedback: 'negative',
        outcomeScore: 0.2,
        timestamp: Date.now() + i,
      },
      {
        taskPattern: 'feature',
        toolsUsed: ['write_file'],
        workspaceDigest: 'digest-2',
        actions: '{}',
      },
    )
  }

  const bugfixResults = store.query({ taskPattern: 'bugfix' })
  assert(bugfixResults.length === 5, `should find 5 bugfix records, got ${bugfixResults.length}`)

  const featureResults = store.query({ taskPattern: 'feature' })
  assert(featureResults.length === 3, `should find 3 feature records, got ${featureResults.length}`)

  const highScoreResults = store.query({ minScore: 0.7 })
  assert(highScoreResults.length === 5, `should find 5 high-score records, got ${highScoreResults.length}`)

  store.close()
})

// ---------------------------------------------------------------------------
// Test 3: Lesson update
// ---------------------------------------------------------------------------

test('update lesson after reflection', () => {
  const store = new ExperienceStore()

  const id = store.store(
    {
      turnId: 'turn-1',
      sessionId: 'session-1',
      goalProgress: 'advanced',
      toolCallCount: 2,
      toolSuccessRate: 1.0,
      guardTriggerCount: 0,
      userFeedback: 'positive',
      outcomeScore: 0.9,
      timestamp: Date.now(),
    },
    {
      taskPattern: 'refactoring',
      toolsUsed: ['edit_file'],
      workspaceDigest: 'digest-1',
      actions: '{}',
    },
  )

  const before = store.getById(id)
  assert(before!.lesson === null, 'lesson should be null before reflection')

  store.updateLesson(id, {
    whatWorked: 'Direct edit was efficient',
    whatFailed: 'Nothing significant',
    whatToTryDifferently: 'Keep using this approach',
    reusableLesson: 'For refactoring, direct edits with read-then-edit pattern is effective',
  })

  const after = store.getById(id)
  assert(
    after!.lesson === 'For refactoring, direct edits with read-then-edit pattern is effective',
    'lesson should be updated',
  )

  store.close()
})

// ---------------------------------------------------------------------------
// Test 4: Confidence decay on reuse
// ---------------------------------------------------------------------------

test('confidence decays with reuse', () => {
  const store = new ExperienceStore()

  const id = store.store(
    {
      turnId: 'turn-1',
      sessionId: 'session-1',
      goalProgress: 'advanced',
      toolCallCount: 1,
      toolSuccessRate: 1.0,
      guardTriggerCount: 0,
      userFeedback: 'positive',
      outcomeScore: 0.85,
      timestamp: Date.now(),
    },
    {
      taskPattern: 'bugfix',
      toolsUsed: ['grep'],
      workspaceDigest: 'd1',
      actions: '{}',
    },
  )

  // Initial confidence
  const rec0 = store.getById(id)
  assertClose(rec0!.confidence, 1.0, 0.01, 'initial confidence should be 1.0')

  // After 1 reuse
  store.incrementReuse(id)
  const rec1 = store.getById(id)
  assertClose(rec1!.confidence, 0.9, 0.01, 'confidence should be 0.9 after 1 reuse')
  assert(rec1!.reuseCount === 1, 'reuseCount should be 1')

  // After 5 reuses
  store.incrementReuse(id)
  store.incrementReuse(id)
  store.incrementReuse(id)
  store.incrementReuse(id)
  store.incrementReuse(id)
  const rec5 = store.getById(id)
  assertClose(rec5!.confidence, 0.4, 0.01, 'confidence should be 0.4 after 6 reuses')
  assert(rec5!.reuseCount === 6, 'reuseCount should be 6')

  // Confidence should not go below 0.1
  for (let i = 0; i < 20; i++) {
    store.incrementReuse(id)
  }
  const recMin = store.getById(id)
  assert(recMin!.confidence >= 0.1, 'confidence should not go below 0.1')

  store.close()
})

// ---------------------------------------------------------------------------
// Test 5: Retention / eviction
// ---------------------------------------------------------------------------

test('retention enforces max records', () => {
  const store = new ExperienceStore()

  // Insert 1100 records
  for (let i = 0; i < 1100; i++) {
    store.store(
      {
        turnId: `turn-${i}`,
        sessionId: 'session-1',
        goalProgress: i % 3 === 0 ? 'advanced' : 'stalled',
        toolCallCount: 1,
        toolSuccessRate: i % 2 === 0 ? 1.0 : 0.5,
        guardTriggerCount: 0,
        userFeedback: 'none',
        outcomeScore: i < 50 ? 0.1 : 0.8, // first 50 are low-score
        timestamp: Date.now() + i,
      },
      {
        taskPattern: 'test',
        toolsUsed: ['tool-a'],
        workspaceDigest: 'd',
        actions: '{}',
      },
    )
  }

  const count = store.count()
  assert(count <= 1000, `should have at most 1000 records, got ${count}`)

  // Low-score records (first 50 with score 0.1) should be evicted first
  const allRecords = store.query({ limit: 1000 })
  const lowScoreRecords = allRecords.filter((r) => r.outcomeScore === 0.1)
  assert(
    lowScoreRecords.length === 0,
    `should have evicted all low-score records, found ${lowScoreRecords.length}`,
  )

  store.close()
})

// ---------------------------------------------------------------------------
// Test 6: Stats
// ---------------------------------------------------------------------------

test('stats aggregation', () => {
  const store = new ExperienceStore()

  store.store(
    {
      turnId: 't1', sessionId: 's1', goalProgress: 'advanced',
      toolCallCount: 2, toolSuccessRate: 1.0, guardTriggerCount: 0,
      userFeedback: 'positive', outcomeScore: 0.9, timestamp: Date.now(),
    },
    { taskPattern: 'bugfix', toolsUsed: ['grep'], workspaceDigest: 'd', actions: '{}' },
  )
  store.store(
    {
      turnId: 't2', sessionId: 's1', goalProgress: 'stalled',
      toolCallCount: 3, toolSuccessRate: 0.33, guardTriggerCount: 1,
      userFeedback: 'negative', outcomeScore: 0.2, timestamp: Date.now(),
    },
    { taskPattern: 'feature', toolsUsed: ['write'], workspaceDigest: 'd', actions: '{}' },
  )

  const stats = store.stats()
  assert(stats.total === 2, `total should be 2, got ${stats.total}`)
  assertClose(stats.avgScore, 0.55, 0.01, `avgScore should be ~0.55, got ${stats.avgScore}`)
  assert(stats.positiveCount === 1, `positiveCount should be 1`)
  assert(stats.negativeCount === 1, `negativeCount should be 1`)
  assert(stats.withLessons === 0, `withLessons should be 0`)

  store.close()
})

// ---------------------------------------------------------------------------
// Test 7: Context hash consistency
// ---------------------------------------------------------------------------

test('context hash is deterministic and order-independent for tools', () => {
  const store = new ExperienceStore()

  const hash1 = store.computeContextHash('bugfix', ['grep', 'edit'], 'digest-1')
  const hash2 = store.computeContextHash('bugfix', ['edit', 'grep'], 'digest-1')

  assert(hash1 === hash2, 'hash should be the same regardless of tool order')

  store.close()
})

console.log(`\n${passed} passed, ${failed} failed\n`)
