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
    stepEfficiency: 0.9,
    difficulty: 'medium',
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
        stepEfficiency: 0.9,
        difficulty: 'medium',
        timestamp: Date.now() + i,
      },
      {
        taskPattern: 'bugfix',
        toolsUsed: ['grep', 'read_file'],
        workspaceDigest: `digest-1-${i}`, // P0: distinct workspaceDigest to avoid dedup
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
        stepEfficiency: 0.75,
        difficulty: 'high',
        timestamp: Date.now() + i,
      },
      {
        taskPattern: 'feature',
        toolsUsed: ['write_file'],
        workspaceDigest: `digest-2-${i}`, // P0: distinct to avoid dedup
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
  assert(after!.lesson !== null, 'lesson should be set')
  // P4: lesson is now stored as JSON Reflection (camelCase)
  const lessonData = JSON.parse(after!.lesson!)
  assert(
    lessonData.reusableLesson === 'For refactoring, direct edits with read-then-edit pattern is effective',
    `reusableLesson should match, got: ${lessonData.reusableLesson}`,
  )
  assert(
    lessonData.whatWorked === 'Direct edit was efficient',
    `whatWorked should match, got: ${lessonData.whatWorked}`,
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
      stepEfficiency: 1.0,
      difficulty: 'low',
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

  // Insert 1100 records — need distinct workspaceDigests to avoid P0 dedup
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
        stepEfficiency: 0.95,
        difficulty: i % 3 === 0 ? 'low' : 'medium',
        outcomeScore: i < 50 ? 0.1 : 0.8, // first 50 are low-score
        timestamp: Date.now() + i,
      },
      {
        taskPattern: 'test',
        toolsUsed: ['tool-a'],
        workspaceDigest: `d-${i}`, // distinct to avoid dedup
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
      userFeedback: 'positive', stepEfficiency: 0.9, difficulty: 'low',
      outcomeScore: 0.9, timestamp: Date.now(),
    },
    { taskPattern: 'bugfix', toolsUsed: ['grep'], workspaceDigest: 'd', actions: '{}' },
  )
  store.store(
    {
      turnId: 't2', sessionId: 's1', goalProgress: 'stalled',
      toolCallCount: 3, toolSuccessRate: 0.33, guardTriggerCount: 1,
      userFeedback: 'negative', stepEfficiency: 0.85, difficulty: 'high',
      outcomeScore: 0.2, timestamp: Date.now(),
    },
    { taskPattern: 'feature', toolsUsed: ['write'], workspaceDigest: 'd2', actions: '{}' },
  )

  const stats = store.stats()
  assert(stats.total === 2, `total should be 2, got ${stats.total}`)
  assertClose(stats.avgScore, 0.55, 0.01, `avgScore should be ~0.55, got ${stats.avgScore}`)
  assert(stats.positiveCount === 1, `positiveCount should be 1`)
  assert(stats.negativeCount === 1, `negativeCount should be 1`)
  assert(stats.withLessons === 0, `withLessons should be 0`)
  assert(stats.youngGenCount === 2, `youngGenCount should be 2`)
  assert(stats.oldGenCount === 0, `oldGenCount should be 0`)
  assert(stats.highDifficultyCount === 1, `highDifficultyCount should be 1`)

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

// ---------------------------------------------------------------------------
// P0 Test 8: Deduplication by context_hash
// ---------------------------------------------------------------------------

test('query deduplicates by context_hash keeping newest', () => {
  const store = new ExperienceStore()

  // Insert 5 records with the SAME context_hash (same tools + workspace)
  for (let i = 0; i < 5; i++) {
    store.store(
      {
        turnId: `turn-${i}`,
        sessionId: 'session-1',
        goalProgress: 'advanced',
        toolCallCount: 2,
        toolSuccessRate: 1.0,
        guardTriggerCount: 0,
        userFeedback: 'positive',
        stepEfficiency: 0.9,
        difficulty: 'medium',
        outcomeScore: 0.8,
        timestamp: Date.now() + i,
      },
      {
        taskPattern: 'bugfix',
        toolsUsed: ['grep', 'read_file'],
        workspaceDigest: 'same-digest', // Same digest → same context_hash
        actions: '{}',
      },
    )
  }

  const results = store.query({})
  assert(results.length === 1, `should deduplicate to 1 record, got ${results.length}`)
  // Should keep the newest one
  assert(results[0].turnId === 'turn-4', 'should keep the newest record')

  store.close()
})

// ---------------------------------------------------------------------------
// P0 Test 9: Difficulty-aware injection ordering
// ---------------------------------------------------------------------------

test('query prioritizes high difficulty experiences', () => {
  const store = new ExperienceStore()

  // Low difficulty experience (high score)
  store.store(
    {
      turnId: 'turn-low',
      sessionId: 's1',
      goalProgress: 'advanced',
      toolCallCount: 2,
      toolSuccessRate: 1.0,
      guardTriggerCount: 0,
      userFeedback: 'positive',
      stepEfficiency: 0.95,
      difficulty: 'low',
      outcomeScore: 0.95,
      timestamp: Date.now(),
    },
    { taskPattern: 'bugfix', toolsUsed: ['grep'], workspaceDigest: 'd1', actions: '{}' },
  )

  // High difficulty experience (lower score but more valuable)
  store.store(
    {
      turnId: 'turn-high',
      sessionId: 's1',
      goalProgress: 'stalled',
      toolCallCount: 8,
      toolSuccessRate: 0.5,
      guardTriggerCount: 2,
      userFeedback: 'none',
      stepEfficiency: 0.65,
      difficulty: 'high',
      outcomeScore: 0.5,
      timestamp: Date.now(),
    },
    { taskPattern: 'bugfix', toolsUsed: ['grep', 'write_file'], workspaceDigest: 'd2', actions: '{}' },
  )

  const results = store.query({ limit: 2 })
  assert(results.length === 2, `should find 2 records, got ${results.length}`)
  // High difficulty should come first despite lower score
  assert(results[0].difficulty === 'high', `high difficulty should be first, got ${results[0].difficulty}`)

  store.close()
})

// ---------------------------------------------------------------------------
// P4 Test 10: Two-stage recall produces relevant results
// ---------------------------------------------------------------------------

test('two-stage recall returns relevant experiences', () => {
  const store = new ExperienceStore()

  // Create records with various tools
  for (let i = 0; i < 10; i++) {
    store.store(
      {
        turnId: `turn-${i}`,
        sessionId: 's1',
        goalProgress: 'advanced',
        toolCallCount: 2,
        toolSuccessRate: 1.0,
        guardTriggerCount: 0,
        userFeedback: 'positive',
        stepEfficiency: 0.9,
        difficulty: 'medium',
        outcomeScore: 0.7 + i * 0.02,
        timestamp: Date.now() + i,
      },
      {
        taskPattern: 'bugfix',
        toolsUsed: ['grep', 'read_file'],
        workspaceDigest: `ws-${i}`,
        actions: '{}',
      },
    )
  }

  // Query with tool context — should use similarity ranking
  const results = store.query({ toolsUsed: ['grep', 'read_file'], limit: 5 })
  assert(results.length <= 5, `should return at most 5, got ${results.length}`)
  // All should have high tool overlap
  for (const rec of results) {
    assert(rec.toolsUsed !== null, 'toolsUsed should not be null')
    assert(rec.toolsUsed!.includes('grep'), 'should include grep')
  }

  store.close()
})

// ---------------------------------------------------------------------------
// P5 Test 11: Export all experiences
// ---------------------------------------------------------------------------

test('export all experiences as JSON', () => {
  const store = new ExperienceStore()

  for (let i = 0; i < 3; i++) {
    store.store(
      {
        turnId: `turn-${i}`,
        sessionId: 'session-1',
        goalProgress: 'advanced',
        toolCallCount: 2,
        toolSuccessRate: 1.0,
        guardTriggerCount: 0,
        userFeedback: 'positive',
        stepEfficiency: 0.9,
        difficulty: i === 0 ? 'low' : 'high',
        outcomeScore: 0.7 + i * 0.1,
        timestamp: Date.now() + i,
      },
      {
        taskPattern: i === 0 ? 'bugfix' : 'feature',
        toolsUsed: ['grep', 'write_file'],
        workspaceDigest: `ws-${i}`,
        actions: '{}',
      },
    )
  }

  const exported = store.exportAll()
  assert(exported.length === 3, `should export 3 records, got ${exported.length}`)
  assert(exported[0].id.length > 0, 'should have id')
  assert(typeof exported[0].outcomeScore === 'number', 'should have outcomeScore')
  assert(Array.isArray(exported[0].toolsUsed), 'should have toolsUsed array')
  assert(exported[0].difficulty === 'low' || exported[0].difficulty === 'high', 'should have difficulty')

  store.close()
})

// ---------------------------------------------------------------------------
// P5 Test 12: Export filtered by task pattern
// ---------------------------------------------------------------------------

test('export filtered by task pattern', () => {
  const store = new ExperienceStore()

  store.store(
    {
      turnId: 'turn-1', sessionId: 's1', goalProgress: 'advanced',
      toolCallCount: 2, toolSuccessRate: 1.0, guardTriggerCount: 0,
      userFeedback: 'positive', stepEfficiency: 0.9, difficulty: 'low',
      outcomeScore: 0.9, timestamp: Date.now(),
    },
    { taskPattern: 'bugfix', toolsUsed: ['grep'], workspaceDigest: 'd1', actions: '{}' },
  )
  store.store(
    {
      turnId: 'turn-2', sessionId: 's1', goalProgress: 'advanced',
      toolCallCount: 3, toolSuccessRate: 1.0, guardTriggerCount: 0,
      userFeedback: 'positive', stepEfficiency: 0.85, difficulty: 'medium',
      outcomeScore: 0.8, timestamp: Date.now(),
    },
    { taskPattern: 'feature', toolsUsed: ['write_file'], workspaceDigest: 'd2', actions: '{}' },
  )

  const bugfixOnly = store.exportByTaskPattern('bugfix')
  assert(bugfixOnly.length === 1, `should export 1 bugfix record, got ${bugfixOnly.length}`)
  assert(bugfixOnly[0].taskPattern === 'bugfix', 'should be bugfix')

  const featureOnly = store.exportByTaskPattern('feature')
  assert(featureOnly.length === 1, `should export 1 feature record, got ${featureOnly.length}`)

  store.close()
})

// ---------------------------------------------------------------------------
// P5 Test 13: Import experiences with deduplication
// ---------------------------------------------------------------------------

test('import experiences with deduplication', () => {
  const store = new ExperienceStore()

  // Pre-populate with one record
  const existingId = store.store(
    {
      turnId: 'turn-existing', sessionId: 's1', goalProgress: 'advanced',
      toolCallCount: 2, toolSuccessRate: 1.0, guardTriggerCount: 0,
      userFeedback: 'positive', stepEfficiency: 0.9, difficulty: 'low',
      outcomeScore: 0.85, timestamp: Date.now(),
    },
    { taskPattern: 'bugfix', toolsUsed: ['grep'], workspaceDigest: 'd1', actions: '{}' },
  )

  // Import data — includes the existing id and 2 new ones
  const importData = [
    {
      id: existingId, // should be skipped (duplicate)
      outcomeScore: 0.9,
      toolsUsed: ['grep'],
      lesson: null,
      difficulty: 'low',
      taskPattern: 'bugfix',
      generation: 0,
      merged: false,
      confidence: 1.0,
      reuseCount: 0,
      createdAt: Date.now(),
      actions: '{}',
    },
    {
      id: 'import-1',
      outcomeScore: 0.75,
      toolsUsed: ['write_file', 'bash'],
      lesson: 'Use bash after write',
      difficulty: 'high',
      taskPattern: 'feature',
      generation: 0,
      merged: false,
      confidence: 1.0,
      reuseCount: 0,
      createdAt: Date.now() - 1000,
      actions: '{"tools":[]}',
    },
    {
      id: 'import-2',
      outcomeScore: 0.6,
      toolsUsed: ['read_file'],
      lesson: null,
      difficulty: 'medium',
      taskPattern: 'refactoring',
      generation: 0,
      merged: false,
      confidence: 1.0,
      reuseCount: 2,
      createdAt: Date.now() - 500,
      actions: '{}',
    },
    {
      id: 'invalid-1', // missing required fields
      outcomeScore: 'not-a-number',
    },
  ]

  const result = store.importExperiences(importData)
  assert(result.imported === 2, `should import 2 new records, got ${result.imported}`)
  assert(result.skipped === 1, `should skip 1 duplicate, got ${result.skipped}`)
  assert(result.invalid === 1, `should mark 1 invalid, got ${result.invalid}`)

  // Verify total count
  assert(store.count() === 3, `should have 3 total records, got ${store.count()}`)

  // Verify imported records are in young gen
  const imported1 = store.query({ toolsUsed: ['write_file', 'bash'], limit: 5 })
  assert(imported1.length > 0, 'imported record should be queryable')

  store.close()
})

// ---------------------------------------------------------------------------
// P5 Test 14: Task pattern inference
// ---------------------------------------------------------------------------

test('task pattern inference classifies messages correctly', async () => {
  const { inferTaskPattern } = await import('../src/types/index.js')

  assert(inferTaskPattern('fix the memory leak in auth.ts') === 'bugfix', 'should detect bugfix')
  assert(inferTaskPattern('add a new login page') === 'feature', 'should detect feature')
  assert(inferTaskPattern('refactor the database layer') === 'refactoring', 'should detect refactoring')
  assert(inferTaskPattern('write tests for the auth module') === 'test-writing', 'should detect test-writing')
  assert(inferTaskPattern('find all files using the old API') === 'search', 'should detect search')
  assert(inferTaskPattern('hello world') === 'general', 'should fallback to general')
})

console.log(`\n${passed} passed, ${failed} failed\n`)
