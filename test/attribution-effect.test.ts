/**
 * Effect-size attribution tests — v2 stage D (配对对照实验)
 *
 * 覆盖 computeEffectSize / aggregateArms（纯函数）与 store 的
 * recordAttributionEvent / queryAttributionArms / applyEffectSizeDelta，
 * 验证效应量驱动 transferConfidence 的对照逻辑。
 */

import { computeEffectSize, aggregateArms } from '../src/attribution.js'
import { ExperienceStore } from '../src/store/experience-store.js'
import type { TurnOutcome } from '../src/types/index.js'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`)
}

function assertEq<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`ASSERT FAILED: ${message} (expected ${expected}, got ${actual})`)
  }
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

console.log('\n=== Effect-size Attribution Tests ===')

// ---------------------------------------------------------------------------
// aggregateArms
// ---------------------------------------------------------------------------

test('aggregateArms: splits used (injected) vs not-used (baseline) arms', () => {
  const counts = aggregateArms([
    { used: true, passed: true },
    { used: true, passed: true },
    { used: true, passed: false },
    { used: false, passed: true },
    { used: false, passed: false },
    { used: false, passed: false },
  ])
  assertEq(counts.injectedTotal, 3, 'injected total')
  assertEq(counts.injectedPass, 2, 'injected pass')
  assertEq(counts.baselineTotal, 3, 'baseline total')
  assertEq(counts.baselinePass, 1, 'baseline pass')
})

test('aggregateArms: empty input → all zero', () => {
  const counts = aggregateArms([])
  assertEq(counts.injectedTotal, 0, 'injected 0')
  assertEq(counts.baselineTotal, 0, 'baseline 0')
})

// ---------------------------------------------------------------------------
// computeEffectSize
// ---------------------------------------------------------------------------

test('computeEffectSize: insufficient samples → neutral + not sufficient', () => {
  const r = computeEffectSize({ injectedTotal: 1, injectedPass: 1, baselineTotal: 1, baselinePass: 0 })
  assertEq(r.sufficient, false, 'not sufficient')
  assertEq(r.direction, 'neutral', 'neutral')
})

test('computeEffectSize: positive effect → reward', () => {
  // injected pass rate = 3/3 = 1.0, baseline = 0/3 = 0.0 → effect = 1.0
  const r = computeEffectSize({ injectedTotal: 3, injectedPass: 3, baselineTotal: 3, baselinePass: 0 })
  assertEq(r.sufficient, true, 'sufficient')
  assertEq(r.direction, 'reward', 'reward')
  assert(r.effectSize > 0.15, 'effect size positive and large')
})

test('computeEffectSize: negative effect → penalty', () => {
  // injected pass rate = 0/3 = 0.0, baseline = 3/3 = 1.0 → effect = -1.0
  const r = computeEffectSize({ injectedTotal: 3, injectedPass: 0, baselineTotal: 3, baselinePass: 3 })
  assertEq(r.direction, 'penalty', 'penalty')
  assert(r.effectSize < -0.15, 'effect size negative and large')
})

test('computeEffectSize: small effect → neutral (within threshold)', () => {
  // injected = 2/3 = 0.667, baseline = 2/3 = 0.667 → effect = 0
  const r = computeEffectSize({ injectedTotal: 3, injectedPass: 2, baselineTotal: 3, baselinePass: 2 })
  assertEq(r.direction, 'neutral', 'neutral (zero effect)')
})

// ---------------------------------------------------------------------------
// store: recordAttributionEvent + queryAttributionArms
// ---------------------------------------------------------------------------

function storeWithKey(store: ExperienceStore, semanticKey: string, id?: string): string {
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
  return store.store(outcome, {
    taskPattern: 'feature',
    toolsUsed: ['read'],
    workspaceDigest: 'ws1',
    actions: JSON.stringify({ tools: [] }),
    semanticKey,
  })
}

test('recordAttributionEvent + queryAttributionArms roundtrip', () => {
  const store = makeStore()
  const expId = storeWithKey(store, 'fix-login')
  store.recordAttributionEvent({ taskUnitId: 'tu1', experienceId: expId, semanticKey: 'fix-login', used: true, passed: true })
  store.recordAttributionEvent({ taskUnitId: 'tu2', experienceId: expId, semanticKey: 'fix-login', used: true, passed: true })
  store.recordAttributionEvent({ taskUnitId: 'tu3', experienceId: expId, semanticKey: 'fix-login', used: true, passed: false })
  // baseline: same semantic key, different experience, not used
  store.recordAttributionEvent({ taskUnitId: 'tu4', experienceId: 'other-exp', semanticKey: 'fix-login', used: false, passed: true })

  const arms = store.queryAttributionArms(expId, 'fix-login')
  assertEq(arms.injectedTotal, 3, 'injected total 3')
  assertEq(arms.injectedPass, 2, 'injected pass 2')
  assertEq(arms.baselineTotal, 1, 'baseline total 1')
  assertEq(arms.baselinePass, 1, 'baseline pass 1')
  store.close()
})

test('applyEffectSizeDelta: reward clamps at max, penalty clamps at min', () => {
  const store = makeStore()
  const expId = storeWithKey(store, 'fix-login')
  // Many rewards → clamp at max (1.0)
  for (let i = 0; i < 100; i++) store.applyEffectSizeDelta(expId, 0.1)
  assertClose(store.getById(expId)!.transferConfidence, 1.0, 1e-9, 'clamped at max')
  // Many penalties → clamp at min (0.0)
  for (let i = 0; i < 100; i++) store.applyEffectSizeDelta(expId, -0.1)
  assertClose(store.getById(expId)!.transferConfidence, 0.0, 1e-9, 'clamped at min')
  store.close()
})

test('listAttributedExperiences: returns distinct experience/semantic pairs', () => {
  const store = makeStore()
  const expId = storeWithKey(store, 'fix-login')
  store.recordAttributionEvent({ taskUnitId: 'tu1', experienceId: expId, semanticKey: 'fix-login', used: true, passed: true })
  const list = store.listAttributedExperiences()
  assert(list.length >= 1, 'should list at least one')
  assert(list.some((l) => l.experienceId === expId && l.semanticKey === 'fix-login'), 'contains the recorded pair')
  store.close()
})

function makeStore(): ExperienceStore {
  return new ExperienceStore()
}

console.log(`\n结果: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)