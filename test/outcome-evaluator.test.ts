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

  // P0: New weights: goal(0.3) + tool(0.2) + efficiency(0.25) + guard(0.15) + feedback(0.1)
  // 2 tools → stepCount=2, stepEfficiency=0.95
  // Expected: 1.0*0.3 + 1.0*0.2 + 0.95*0.25 + 0.15 + 1.0*0.1 = 0.9875
  assertClose(outcome.outcomeScore, 0.9875, 0.01, 'perfect turn should score ~0.99')
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

  // P0: 3 tools → stepCount=3, stepEfficiency=0.9, hasFailures → difficulty='high'
  // Expected: 0.0*0.3 + 0.0*0.2 + 0.9*0.25 + (0.15-0.1) + 0.0*0.1 = 0.275
  assertClose(outcome.outcomeScore, 0.275, 0.01, 'terrible turn should score ~0.275')
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

  // P0: 2 tools → stepCount=2, stepEfficiency=0.95, hasFailures → difficulty='high'
  // O7: neutral feedback = 0.6 (aligned with index.ts runtime)
  // Expected: 0.3*0.3 + 0.5*0.2 + 0.95*0.25 + 0.15 + 0.6*0.1 = 0.6375
  assertClose(outcome.outcomeScore, 0.6375, 0.01, 'mixed turn should score ~0.64')
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

  // P0: 1 tool → stepCount=1, stepEfficiency=1.0
  // guard penalty = min(4 * 0.1, 0.15) = 0.15 → guard component = 0
  // O7: neutral feedback = 0.6
  // Expected: 0.3*0.3 + 1.0*0.2 + 1.0*0.25 + 0 + 0.6*0.1 = 0.61
  assertClose(outcome.outcomeScore, 0.61, 0.01, 'should cap guard penalty at weight')

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

  // P0: 0 tools → stepCount=0, stepEfficiency=1.0, difficulty='low'
  // O7: neutral feedback = 0.6
  // Expected: 0.5*0.3 + 0*0.2 + 1.0*0.25 + 0.15 + 0.6*0.1 = 0.61
  assertClose(outcome.outcomeScore, 0.61, 0.01, 'empty turn should score ~0.61')
  assert(outcome.toolCallCount === 0, 'toolCallCount should be 0')
  assert(outcome.toolSuccessRate === 0.0, 'toolSuccessRate should be 0 with no calls')

  store.close()
})

// ---------------------------------------------------------------------------
// P0 Test 7: Step efficiency dimension
// ---------------------------------------------------------------------------

test('step efficiency differentiates 2-step vs 18-step turns', () => {
  const store = new ExperienceStore()
  const evaluator = new OutcomeEvaluator(store)

  // 2-step turn — high efficiency
  const shortData: TurnData = {
    turnId: 'turn-short',
    sessionId: 'session-1',
    goalProgress: 'advanced',
    toolResults: [
      { toolName: 'read_file', success: true, durationMs: 100 },
      { toolName: 'edit_file', success: true, durationMs: 200 },
    ],
    guardTriggers: [],
    userFeedback: 'positive',
    stepCount: 2,
    timestamp: Date.now(),
  }

  // 18-step turn — low efficiency
  const longData: TurnData = {
    turnId: 'turn-long',
    sessionId: 'session-1',
    goalProgress: 'advanced',
    toolResults: Array(18).fill({ toolName: 'grep', success: true, durationMs: 100 }),
    guardTriggers: [],
    userFeedback: 'positive',
    stepCount: 18,
    timestamp: Date.now(),
  }

  const shortOutcome = evaluator.evaluate(shortData)
  const longOutcome = evaluator.evaluate(longData)

  // Both have same goal/tools/guard/feedback, but different step efficiency
  assertClose(shortOutcome.stepEfficiency, 0.95, 0.01, '2-step efficiency should be 0.95')
  assertClose(longOutcome.stepEfficiency, 0.15, 0.01, '18-step efficiency should be 0.15')
  assert(shortOutcome.outcomeScore > longOutcome.outcomeScore, 'short turn should score higher than long turn')

  store.close()
})

// ---------------------------------------------------------------------------
// P0 Test 8: Difficulty classification
// ---------------------------------------------------------------------------

test('difficulty is computed correctly', () => {
  const store = new ExperienceStore()
  const evaluator = new OutcomeEvaluator(store)

  // 1 step, all success → low
  const easyData: TurnData = {
    turnId: 't-easy',
    sessionId: 's1',
    goalProgress: 'advanced',
    toolResults: [{ toolName: 'write_file', success: true, durationMs: 50 }],
    guardTriggers: [],
    userFeedback: 'positive',
    stepCount: 1,
    timestamp: Date.now(),
  }

  // 5 steps, all success → medium
  const mediumData: TurnData = {
    turnId: 't-medium',
    sessionId: 's1',
    goalProgress: 'advanced',
    toolResults: Array(5).fill({ toolName: 'grep', success: true, durationMs: 50 }),
    guardTriggers: [],
    userFeedback: 'positive',
    stepCount: 5,
    timestamp: Date.now(),
  }

  // 10 steps, with failure → high
  const hardData: TurnData = {
    turnId: 't-hard',
    sessionId: 's1',
    goalProgress: 'stalled',
    toolResults: [
      ...Array(9).fill({ toolName: 'grep', success: true, durationMs: 50 }),
      { toolName: 'write_file', success: false, durationMs: 200 },
    ],
    guardTriggers: [],
    userFeedback: 'none',
    stepCount: 10,
    timestamp: Date.now(),
  }

  // 2 steps, all success → low
  const twoStepData: TurnData = {
    turnId: 't-two',
    sessionId: 's1',
    goalProgress: 'advanced',
    toolResults: [
      { toolName: 'read_file', success: true, durationMs: 50 },
      { toolName: 'edit_file', success: true, durationMs: 50 },
    ],
    guardTriggers: [],
    userFeedback: 'positive',
    stepCount: 2,
    timestamp: Date.now(),
  }

  assert(evaluator.evaluate(easyData).difficulty === 'low', '1-step all success should be low')
  assert(evaluator.evaluate(twoStepData).difficulty === 'low', '2-step all success should be low')
  assert(evaluator.evaluate(mediumData).difficulty === 'medium', '5-step all success should be medium')
  assert(evaluator.evaluate(hardData).difficulty === 'high', '10-step with failure should be high')

  store.close()
})

console.log(`\n${passed} passed, ${failed} failed\n`)
