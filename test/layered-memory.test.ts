/**
 * Layered memory tests — v2 stage E (分层记忆与遗忘)
 *
 * 覆盖 promoteToStrategy / demoteFromStrategy / forgetStrategy，
 * 验证记忆按认知价值分层（event → strategy），遗忘由 transferConfidence 驱动
 * 而非容量（design-v2 §6）。
 */

import { ExperienceStore } from '../src/store/experience-store.js'
import type { TurnOutcome } from '../src/types/index.js'
import { MEMORY_TIER_EVENT, MEMORY_TIER_STRATEGY } from '../src/types/constants.js'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`)
}

function assertEq<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
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

console.log('\n=== Layered Memory Tests ===')

function makeStore(): ExperienceStore {
  return new ExperienceStore()
}

function storeWith(store: ExperienceStore, opts: {
  lesson?: boolean
  transferConfidence?: number
}): string {
  const outcome: TurnOutcome = {
    turnId: 'turn-1',
    sessionId: 'session-1',
    goalProgress: 'advanced',
    toolCallCount: 1,
    toolSuccessRate: 1.0,
    guardTriggerCount: 0,
    userFeedback: 'none',
    stepEfficiency: 1.0,
    difficulty: 'medium',
    outcomeScore: 0.8,
    timestamp: Date.now(),
  }
  const id = store.store(outcome, {
    taskPattern: 'feature',
    toolsUsed: ['read'],
    workspaceDigest: 'ws1',
    actions: JSON.stringify({ tools: [] }),
  })
  if (opts.lesson) {
    store.updateLesson(id, { whatWorked: 'x', whatFailed: '', whatToTryDifferently: '', reusableLesson: 'a lesson' })
  }
  if (opts.transferConfidence !== undefined) {
    // Set transfer_confidence directly via a raw update for test precision.
    store.applyEffectSizeDelta(id, opts.transferConfidence - 0.5)
  }
  return id
}

// ---------------------------------------------------------------------------
// promoteToStrategy
// ---------------------------------------------------------------------------

test('new experience starts in event tier', () => {
  const store = makeStore()
  const id = storeWith(store, {})
  assertEq(store.getById(id)!.memoryTier, MEMORY_TIER_EVENT, 'starts event tier')
  store.close()
})

test('promoteToStrategy: high transferConfidence + lesson → strategy', () => {
  const store = makeStore()
  const id = storeWith(store, { lesson: true, transferConfidence: 0.9 })
  const promoted = store.promoteToStrategy()
  assert(promoted >= 1, 'should promote at least one')
  assertEq(store.getById(id)!.memoryTier, MEMORY_TIER_STRATEGY, 'now strategy tier')
  store.close()
})

test('promoteToStrategy: low transferConfidence → stays event', () => {
  const store = makeStore()
  const id = storeWith(store, { lesson: true, transferConfidence: 0.2 })
  store.promoteToStrategy()
  assertEq(store.getById(id)!.memoryTier, MEMORY_TIER_EVENT, 'stays event (low transfer)')
  store.close()
})

test('promoteToStrategy: no lesson → stays event even with high transfer', () => {
  const store = makeStore()
  const id = storeWith(store, { transferConfidence: 0.9 }) // no lesson
  store.promoteToStrategy()
  assertEq(store.getById(id)!.memoryTier, MEMORY_TIER_EVENT, 'no lesson → stays event')
  store.close()
})

// ---------------------------------------------------------------------------
// demoteFromStrategy
// ---------------------------------------------------------------------------

test('demoteFromStrategy: low transferConfidence → back to event', () => {
  const store = makeStore()
  const id = storeWith(store, { lesson: true, transferConfidence: 0.9 })
  store.promoteToStrategy()
  assertEq(store.getById(id)!.memoryTier, MEMORY_TIER_STRATEGY, 'promoted first')

  // Drop transferConfidence below demote threshold (0.3)
  store.applyEffectSizeDelta(id, -0.7) // 0.9 → 0.2
  const demoted = store.demoteFromStrategy()
  assert(demoted >= 1, 'should demote at least one')
  assertEq(store.getById(id)!.memoryTier, MEMORY_TIER_EVENT, 'demoted back to event')
  store.close()
})

// ---------------------------------------------------------------------------
// forgetStrategy
// ---------------------------------------------------------------------------

test('forgetStrategy: very low transferConfidence → deleted', () => {
  const store = makeStore()
  const id = storeWith(store, { lesson: true, transferConfidence: 0.9 })
  store.promoteToStrategy()

  // Drop below forget threshold (0.15)
  store.applyEffectSizeDelta(id, -0.85) // 0.9 → 0.05
  const forgotten = store.forgetStrategy()
  assert(forgotten >= 1, 'should forget at least one')
  assertEq(store.getById(id), null, 'record deleted')
  store.close()
})

test('forgetStrategy: does NOT delete event-tier records', () => {
  const store = makeStore()
  const id = storeWith(store, { transferConfidence: 0.05 }) // event tier, low transfer
  const forgotten = store.forgetStrategy()
  assertEq(forgotten, 0, 'no strategy records to forget')
  assert(store.getById(id) !== null, 'event-tier record survives')
  store.close()
})

console.log(`\n结果: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)