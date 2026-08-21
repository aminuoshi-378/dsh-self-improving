/**
 * Outcome Evaluator tests — Layer 1
 */

import { ExperienceStore } from '../src/store/experience-store.js'
import { OutcomeEvaluator } from '../src/evaluator/outcome-evaluator.js'
import type { TurnData } from '../src/types/index.js'

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

console.log('\n=== Outcome Evaluator Tests ===')

// ---------------------------------------------------------------------------
// Test 1: Perfect turn
// ---------------------------------------------------------------------------

test('perfect turn gets high score', () => {
  const store = new ExperienceStore()
  const evaluator = new OutcomeEvaluator(store)

  const data: TurnData = {
    turnId: 'turn-1',
    sessionId: 'session-1',
    goalProgress: 'advanced',
    toolResults: [
      { toolName: 'read_file', success: true, durationMs: 100 },
      { toolName: 'edit_file', success: true, durationMs: 200 },
    ],
    guardTriggers: [],
    userFeedback: 'positive',
    timestamp: Date.now(),
  }

  const outcome = evaluator.evaluate(data)

  // Expected: goal(1.0)*0.4 + tool(1.0)*0.25 + guard(0.15) + feedback(1.0)*0.2
  // = 0.4 + 0.25 + 0.15 + 0.2 = 1.0
  assertClose(outcome.outcomeScore, 1.0, 0.01, 'perfect turn should score 1.0')
  assert(outcome.goalProgress === 'advanced', 'goalProgress should be advanced')
  assert(outcome.toolSuccessRate === 1.0, 'toolSuccessRate should be 1.0')
  assert(outcome.guardTriggerCount === 0, 'guardTriggerCount should be 0')
  assert(outcome.userFeedback === 'positive', 'userFeedback should be positive')

  store.close()
})

// ---------------------------------------------------------------------------
// Test 2: Terrible turn
// ---------------------------------------------------------------------------

test('terrible turn gets low score', () => {
  const store = new ExperienceStore()
  const evaluator = new OutcomeEvaluator(store)

  const data: TurnData = {
    turnId: 'turn-2',
    sessionId: 'session-1',
    goalProgress: 'regressed',
    toolResults: [
      { toolName: 'write_file', success: false, durationMs: 500 },
      { toolName: 'write_file', success: false, durationMs: 500 },
      { toolName: 'write_file', success: false, durationMs: 500 },
    ],
    guardTriggers: [
      { guardName: 'repeat-tool-reminder', reason: 'consecutive identical calls' },
    ],
    userFeedback: 'negative',
    timestamp: Date.now(),
  }

  const outcome = evaluator.evaluate(data)

  // Expected: goal(0.0)*0.4 + tool(0.0)*0.25 + guard(0.15-0.1=0.05) + feedback(0.0)*0.2
  // = 0 + 0 + 0.05 + 0 = 0.05
  assertClose(outcome.outcomeScore, 0.05, 0.01, 'terrible turn should score ~0.05')
  assert(outcome.goalProgress === 'regressed', 'goalProgress should be regressed')
  assert(outcome.toolSuccessRate === 0.0, 'toolSuccessRate should be 0.0')
  assert(outcome.guardTriggerCount === 1, 'guardTriggerCount should be 1')

  store.close()
})

// ---------------------------------------------------------------------------
// Test 3: Mixed turn
// ---------------------------------------------------------------------------

test('mixed turn gets middle score', () => {
  const store = new ExperienceStore()
  const evaluator = new OutcomeEvaluator(store)

  const data: TurnData = {
    turnId: 'turn-3',
    sessionId: 'session-1',
    goalProgress: 'stalled',
    toolResults: [
      { toolName: 'grep', success: true, durationMs: 100 },
      { toolName: 'write_file', success: false, durationMs: 300 },
    ],
    guardTriggers: [],
    userFeedback: 'none',
    timestamp: Date.now(),
  }

  const outcome = evaluator.evaluate(data)

  // Expected: goal(0.3)*0.4 + tool(0.5)*0.25 + guard(0.15) + feedback(0.5)*0.2
  // = 0.12 + 0.125 + 0.15 + 0.1 = 0.495
  assertClose(outcome.outcomeScore, 0.495, 0.01, 'mixed turn should score ~0.495')
  assert(outcome.toolCallCount === 2, 'toolCallCount should be 2')
  assertClose(outcome.toolSuccessRate, 0.5, 0.01, 'toolSuccessRate should be 0.5')

  store.close()
})

// ---------------------------------------------------------------------------
// Test 4: Multiple guard triggers max penalty
// ---------------------------------------------------------------------------

test('multiple guard triggers cap at guard weight', () => {
  const store = new ExperienceStore()
  const evaluator = new OutcomeEvaluator(store)

  const data: TurnData = {
    turnId: 'turn-4',
    sessionId: 'session-1',
    goalProgress: 'stalled',
    toolResults: [
      { toolName: 'grep', success: true, durationMs: 100 },
    ],
    guardTriggers: [
      { guardName: 'repeat-tool-reminder', reason: 'repeat 1' },
      { guardName: 'repeat-tool-reminder', reason: 'repeat 2' },
      { guardName: 'repeat-tool-reminder', reason: 'repeat 3' },
      { guardName: 'repeat-tool-reminder', reason: 'repeat 4' },
    ],
    userFeedback: 'none',
    timestamp: Date.now(),
  }

  const outcome = evaluator.evaluate(data)

  // guard penalty = min(4 * 0.1, 0.15) = 0.15 → guard component = 0
  // goal(0.3)*0.4 + tool(1.0)*0.25 + guard(0) + feedback(0.5)*0.2
  // = 0.12 + 0.25 + 0 + 0.1 = 0.47
  assertClose(outcome.outcomeScore, 0.47, 0.01, 'should cap guard penalty at weight')

  store.close()
})

// ---------------------------------------------------------------------------
// Test 5: evaluateAndStore stores in DB
// ---------------------------------------------------------------------------

test('evaluateAndStore stores result in Experience Store', () => {
  const store = new ExperienceStore()
  const evaluator = new OutcomeEvaluator(store)

  const data: TurnData = {
    turnId: 'turn-5',
    sessionId: 'session-1',
    goalProgress: 'advanced',
    toolResults: [
      { toolName: 'read_file', success: true, durationMs: 100 },
    ],
    guardTriggers: [],
    userFeedback: 'positive',
    timestamp: Date.now(),
  }

  const id = evaluator.evaluateAndStore(data, {
    taskPattern: 'bugfix',
    toolsUsed: ['read_file'],
    workspaceDigest: 'digest-1',
  })

  assert(id.length > 0, 'should return an id')
  assert(store.count() === 1, 'store should have 1 record')

  const rec = store.getById(id)
  assert(rec !== null, 'record should exist')
  assert(rec!.taskPattern === 'bugfix', 'taskPattern should be stored')
  assert(rec!.turnId === 'turn-5', 'turnId should match')

  // The actions field should be a valid JSON string with tool summaries
  const actions = JSON.parse(rec!.actions)
  assert(actions.tools.length === 1, 'actions should have 1 tool')
  assert(actions.tools[0].tool === 'read_file', 'tool name should match')
  assert(actions.tools[0].ok === true, 'tool success should be recorded')

  store.close()
})

// ---------------------------------------------------------------------------
// Test 6: No tool calls
// ---------------------------------------------------------------------------

test('turn with no tool calls', () => {
  const store = new ExperienceStore()
  const evaluator = new OutcomeEvaluator(store)

  const data: TurnData = {
    turnId: 'turn-6',
    sessionId: 'session-1',
    goalProgress: 'none',
    toolResults: [],
    guardTriggers: [],
    userFeedback: 'none',
    timestamp: Date.now(),
  }

  const outcome = evaluator.evaluate(data)

  // goal(0.5)*0.4 + tool(0)*0.25 + guard(0.15) + feedback(0.5)*0.2
  // = 0.2 + 0 + 0.15 + 0.1 = 0.45
  assertClose(outcome.outcomeScore, 0.45, 0.01, 'empty turn should score ~0.45')
  assert(outcome.toolCallCount === 0, 'toolCallCount should be 0')
  assert(outcome.toolSuccessRate === 0.0, 'toolSuccessRate should be 0 with no calls')

  store.close()
})

console.log(`\n${passed} passed, ${failed} failed\n`)
