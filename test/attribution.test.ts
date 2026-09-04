/**
 * Attribution tests — v2 stage B (双向归因)
 *
 * 覆盖 applyAttribution（transferConfidence 双向归因）与
 * decayTransferConfidence（时间衰减），验证单向乐观偏置已被双向归因取代。
 */

import { ExperienceStore } from '../src/store/experience-store.js'
import type { TurnOutcome } from '../src/types/index.js'
import {
  TRANSFER_CONFIDENCE_INITIAL,
  TRANSFER_REWARD_PASS_USED,
  TRANSFER_PENALTY_FAIL_USED,
  TRANSFER_CONFIDENCE_MAX,
  TRANSFER_CONFIDENCE_MIN,
  TRANSFER_DECAY_FACTOR,
} from '../src/types/constants.js'

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

console.log('\n=== Attribution Tests ===')

function makeStore(): ExperienceStore {
  return new ExperienceStore()
}

function storeOne(store: ExperienceStore, toolsUsed: string[]): string {
  const outcome: TurnOutcome = {
    turnId: 'turn-1',
    sessionId: 'session-1',
    goalProgress: 'advanced',
    toolCallCount: toolsUsed.length,
    toolSuccessRate: 1.0,
    guardTriggerCount: 0,
    userFeedback: 'none',
    stepEfficiency: 1.0,
    difficulty: 'medium',
    outcomeScore: 0.8,
    timestamp: Date.now(),
  }
  return store.store(outcome, {
    taskPattern: 'feature',
    toolsUsed,
    workspaceDigest: 'ws1',
    actions: JSON.stringify({ tools: [] }),
  })
}

// ---------------------------------------------------------------------------
// applyAttribution
// ---------------------------------------------------------------------------

test('transferConfidence starts at initial value', () => {
  const store = makeStore()
  const id = storeOne(store, ['read', 'edit'])
  const rec = store.getById(id)!
  assertClose(rec.transferConfidence, TRANSFER_CONFIDENCE_INITIAL, 1e-9, 'initial transferConfidence')
  store.close()
})

test('applyAttribution: pass + used → reward', () => {
  const store = makeStore()
  const id = storeOne(store, ['read', 'edit'])
  store.applyAttribution([{ experienceId: id, used: true, passed: true }])
  const rec = store.getById(id)!
  assertClose(
    rec.transferConfidence,
    TRANSFER_CONFIDENCE_INITIAL + TRANSFER_REWARD_PASS_USED,
    1e-9,
    'reward on pass+used',
  )
  store.close()
})

test('applyAttribution: fail + used → penalty', () => {
  const store = makeStore()
  const id = storeOne(store, ['read', 'edit'])
  store.applyAttribution([{ experienceId: id, used: true, passed: false }])
  const rec = store.getById(id)!
  assertClose(
    rec.transferConfidence,
    TRANSFER_CONFIDENCE_INITIAL - TRANSFER_PENALTY_FAIL_USED,
    1e-9,
    'penalty on fail+used',
  )
  store.close()
})

test('applyAttribution: not used → no change (regardless of pass/fail)', () => {
  const store = makeStore()
  const idPass = storeOne(store, ['read'])
  const idFail = storeOne(store, ['bash'])
  store.applyAttribution([
    { experienceId: idPass, used: false, passed: true },
    { experienceId: idFail, used: false, passed: false },
  ])
  assertClose(store.getById(idPass)!.transferConfidence, TRANSFER_CONFIDENCE_INITIAL, 1e-9, 'not-used pass unchanged')
  assertClose(store.getById(idFail)!.transferConfidence, TRANSFER_CONFIDENCE_INITIAL, 1e-9, 'not-used fail unchanged')
  store.close()
})

test('applyAttribution: clamps to MAX and MIN bounds', () => {
  const store = makeStore()
  const id = storeOne(store, ['read'])
  // Many rewards should clamp at MAX
  for (let i = 0; i < 100; i++) {
    store.applyAttribution([{ experienceId: id, used: true, passed: true }])
  }
  assertClose(store.getById(id)!.transferConfidence, TRANSFER_CONFIDENCE_MAX, 1e-9, 'clamped at max')
  // Many penalties should clamp at MIN
  for (let i = 0; i < 100; i++) {
    store.applyAttribution([{ experienceId: id, used: true, passed: false }])
  }
  assertClose(store.getById(id)!.transferConfidence, TRANSFER_CONFIDENCE_MIN, 1e-9, 'clamped at min')
  store.close()
})

test('applyAttribution: empty input is a no-op', () => {
  const store = makeStore()
  const id = storeOne(store, ['read'])
  store.applyAttribution([])
  assertClose(store.getById(id)!.transferConfidence, TRANSFER_CONFIDENCE_INITIAL, 1e-9, 'empty no-op')
  store.close()
})

// ---------------------------------------------------------------------------
// decayTransferConfidence
// ---------------------------------------------------------------------------

test('decayTransferConfidence: reduces transferConfidence by decay factor', () => {
  const store = makeStore()
  const id = storeOne(store, ['read'])
  store.decayTransferConfidence([id])
  const rec = store.getById(id)!
  assertClose(
    rec.transferConfidence,
    TRANSFER_CONFIDENCE_INITIAL * TRANSFER_DECAY_FACTOR,
    1e-9,
    'decayed by decay factor',
  )
  store.close()
})

test('decayTransferConfidence: empty ids is a no-op', () => {
  const store = makeStore()
  const id = storeOne(store, ['read'])
  store.decayTransferConfidence([])
  assertClose(store.getById(id)!.transferConfidence, TRANSFER_CONFIDENCE_INITIAL, 1e-9, 'empty decay no-op')
  store.close()
})

console.log(`\n结果: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)