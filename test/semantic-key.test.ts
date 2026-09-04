/**
 * Semantic key tests — v2 stage C (语义检索)
 *
 * 覆盖 generateSemanticKeyRuleBased（规则降级）与 queryBySemanticKey（语义召回），
 * 验证语义签名能区分"同工具不同任务"（D4 缺陷）。
 */

import { generateSemanticKeyRuleBased } from '../src/semantic-key.js'
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

console.log('\n=== Semantic Key Tests ===')

// ---------------------------------------------------------------------------
// generateSemanticKeyRuleBased
// ---------------------------------------------------------------------------

test('generateSemanticKeyRuleBased: verb + subject → "verb-subject"', () => {
  assertEq(
    generateSemanticKeyRuleBased('fix the login timeout bug'),
    'fix-login-timeout',
    'fix-login-timeout',
  )
})

test('generateSemanticKeyRuleBased: add task → "add-subject"', () => {
  assertEq(
    generateSemanticKeyRuleBased('add a npm test script'),
    'add-npm-script',
    'add-npm-script',
  )
})

test('generateSemanticKeyRuleBased: refactor task → "refactor-subject"', () => {
  assertEq(
    generateSemanticKeyRuleBased('refactor the user module'),
    'refactor-user-module',
    'refactor-user-module',
  )
})

test('generateSemanticKeyRuleBased: no verb → subject only', () => {
  const key = generateSemanticKeyRuleBased('hello world documentation')
  assert(key !== null && key.length > 0, 'should derive a subject-only key')
})

test('generateSemanticKeyRuleBased: empty input → null', () => {
  assertEq(generateSemanticKeyRuleBased(''), null, 'empty → null')
  assertEq(generateSemanticKeyRuleBased('   '), null, 'whitespace → null')
})

// ---------------------------------------------------------------------------
// queryBySemanticKey (semantic retrieval)
// ---------------------------------------------------------------------------

function makeStore(): ExperienceStore {
  return new ExperienceStore()
}

function storeWithKey(store: ExperienceStore, semanticKey: string, toolsUsed: string[], score: number): string {
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
    outcomeScore: score,
    timestamp: Date.now(),
  }
  return store.store(outcome, {
    taskPattern: 'feature',
    toolsUsed,
    workspaceDigest: 'ws1',
    actions: JSON.stringify({ tools: [] }),
    semanticKey,
  })
}

test('queryBySemanticKey: exact semantic key match is returned', () => {
  const store = makeStore()
  storeWithKey(store, 'fix-login', ['read', 'edit'], 0.9)
  const results = store.queryBySemanticKey('fix-login', { limit: 10 })
  assert(results.length >= 1, 'should find exact match')
  assertEq(results[0].semanticKey, 'fix-login', 'semantic key matches')
  store.close()
})

test('queryBySemanticKey: same tools, different semantic key do NOT collide (D4 fix)', () => {
  const store = makeStore()
  // Two tasks both using ['read', 'edit'] but semantically different.
  storeWithKey(store, 'fix-login', ['read', 'edit'], 0.9)
  storeWithKey(store, 'add-test-script', ['read', 'edit'], 0.8)

  // Retrieving by "fix-login" should prioritize the fix-login experience, not add-test-script.
  const results = store.queryBySemanticKey('fix-login', { limit: 10 })
  assert(results.length >= 1, 'should find at least one')
  assertEq(results[0].semanticKey, 'fix-login', 'top result is the semantically-matched one')
  store.close()
})

test('queryBySemanticKey: null key falls back to taskPattern', () => {
  const store = makeStore()
  storeWithKey(store, 'fix-login', ['read'], 0.9)
  // No semantic key → fall back to taskPattern 'feature'
  const results = store.queryBySemanticKey(null, { limit: 10, taskPattern: 'feature' })
  assert(results.length >= 1, 'taskPattern fallback finds records')
  store.close()
})

test('queryBySemanticKey: null key and no taskPattern → empty', () => {
  const store = makeStore()
  const results = store.queryBySemanticKey(null, { limit: 10 })
  assertEq(results.length, 0, 'empty when no key and no taskPattern')
  store.close()
})

test('queryBySemanticKey: partial token prefix match is returned', () => {
  const store = makeStore()
  storeWithKey(store, 'add-npm-test-script', ['bash'], 0.9)
  storeWithKey(store, 'fix-login', ['read'], 0.8)
  // "add-npm" shares the "add" token with "add-npm-test-script"
  const results = store.queryBySemanticKey('add-npm', { limit: 10 })
  assert(results.length >= 1, 'should find prefix/overlap match')
  store.close()
})

console.log(`\n结果: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)