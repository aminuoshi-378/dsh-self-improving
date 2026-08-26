/**
 * Adaptive strategy tests — Phase 6 (self-tuning runtime behavior)
 *
 * Tests the pure policy functions `selectModel` (model selection) and
 * `guardTool` (tool guarding) in isolation from dsh event wiring.
 */

import { ExperienceStore } from '../src/store/experience-store.js'
import { selectModel, guardTool } from '../src/adaptive-strategy.js'
import type { TurnOutcome } from '../src/types/index.js'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`)
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

function makeOutcome(overrides: Partial<TurnOutcome> = {}): TurnOutcome {
  return {
    turnId: 'turn-1',
    sessionId: 'session-1',
    goalProgress: 'advanced',
    toolCallCount: 3,
    toolSuccessRate: 1.0,
    guardTriggerCount: 0,
    userFeedback: 'none',
    stepEfficiency: 0.9,
    difficulty: 'medium',
    outcomeScore: 0.8,
    timestamp: Date.now(),
    ...overrides,
  }
}

function seedExperiences(store: ExperienceStore, scores: number[], taskPattern = 'bugfix'): void {
  scores.forEach((score, i) => {
    // Use a distinct tool per experience so content-hash dedup doesn't collapse them
    // (model selection reads taskPatternStats, which is dedup-independent anyway).
    store.store(makeOutcome({ outcomeScore: score, turnId: `turn-${i}` }), {
      taskPattern,
      toolsUsed: [`tool${i}`, 'bash'],
      workspaceDigest: 'ws-test',
      actions: JSON.stringify({ tools: [{ name: `tool${i}`, success: true }, { name: 'bash', success: true }] }),
    })
  })
}

function seedFailedTool(store: ExperienceStore, toolName: string, turnId: string): void {
  store.store(makeOutcome({ outcomeScore: 0.2, turnId }), {
    taskPattern: 'bugfix',
    toolsUsed: [toolName, 'bash'],
    workspaceDigest: 'ws-test',
    actions: JSON.stringify({ tools: [{ name: toolName, success: false }, { name: 'bash', success: false }] }),
  })
}

// ---------------------------------------------------------------------------
// Phase 6-1: Model selection
// ---------------------------------------------------------------------------

console.log('\n--- Phase 6-1: Adaptive Model Selection ---')

test('selectModel returns null when strongModel is empty (disabled)', () => {
  const store = new ExperienceStore()
  const result = selectModel('bugfix', store, '', 'deepseek-chat')
  assert(result === null, 'should return null when strongModel is empty')
  store.close()
})

test('selectModel returns null with insufficient samples', () => {
  const store = new ExperienceStore()
  seedExperiences(store, [0.9, 0.8, 0.7], 'bugfix') // only 3 < 5 samples
  const result = selectModel('bugfix', store, 'deepseek-reasoner', 'deepseek-chat')
  assert(result === null, 'should return null with < 5 samples')
  store.close()
})

test('selectModel recommends standard model for high avg score', () => {
  const store = new ExperienceStore()
  seedExperiences(store, [0.95, 0.9, 0.85, 0.9, 0.92], 'bugfix')
  const result = selectModel('bugfix', store, 'deepseek-reasoner', 'deepseek-chat')
  assert(result !== null, 'should recommend a model')
  assert(result!.model === 'deepseek-chat', 'high avg score → standard model')
  store.close()
})

test('selectModel recommends strong model for low avg score', () => {
  const store = new ExperienceStore()
  seedExperiences(store, [0.3, 0.4, 0.2, 0.35, 0.25], 'bugfix')
  const result = selectModel('bugfix', store, 'deepseek-reasoner', 'deepseek-chat')
  assert(result !== null, 'should recommend a model')
  assert(result!.model === 'deepseek-reasoner', 'low avg score → strong model')
  store.close()
})

test('selectModel returns null for mid-range avg score', () => {
  const store = new ExperienceStore()
  seedExperiences(store, [0.6, 0.65, 0.7, 0.6, 0.62], 'bugfix')
  const result = selectModel('bugfix', store, 'deepseek-reasoner', 'deepseek-chat')
  assert(result === null, 'mid-range avg score → keep current model')
  store.close()
})

test('selectModel respects task pattern filtering', () => {
  const store = new ExperienceStore()
  // bugfix has low scores, feature has high scores
  seedExperiences(store, [0.3, 0.4, 0.2, 0.35, 0.25], 'bugfix')
  seedExperiences(store, [0.95, 0.9, 0.85, 0.9, 0.92], 'feature')

  const bugfixResult = selectModel('bugfix', store, 'deepseek-reasoner', 'deepseek-chat')
  assert(bugfixResult !== null && bugfixResult.model === 'deepseek-reasoner', 'bugfix (low) → strong model')

  const featureResult = selectModel('feature', store, 'deepseek-reasoner', 'deepseek-chat')
  assert(featureResult !== null && featureResult.model === 'deepseek-chat', 'feature (high) → standard model')
  store.close()
})

// ---------------------------------------------------------------------------
// Phase 6-2: Tool guarding
// ---------------------------------------------------------------------------

console.log('\n--- Phase 6-2: Adaptive Tool Guard ---')

test('guardTool allows when threshold is 0 (disabled)', () => {
  const store = new ExperienceStore()
  const result = guardTool('bash', store, 0)
  assert(result.kind === 'allow', 'threshold 0 → allow')
  store.close()
})

test('guardTool allows when no failed experiences exist', () => {
  const store = new ExperienceStore()
  const result = guardTool('bash', store, 3)
  assert(result.kind === 'allow', 'no failed experiences → allow')
  store.close()
})

test('guardTool allows when failures are below threshold', () => {
  const store = new ExperienceStore()
  seedFailedTool(store, 'bash', 't1')
  seedFailedTool(store, 'bash', 't2')
  const result = guardTool('bash', store, 3)
  assert(result.kind === 'allow', '2 failures < 3 threshold → allow')
  store.close()
})

test('guardTool denies when failures reach threshold', () => {
  const store = new ExperienceStore()
  seedFailedTool(store, 'bash', 't1')
  seedFailedTool(store, 'bash', 't2')
  seedFailedTool(store, 'bash', 't3')
  const result = guardTool('bash', store, 3)
  assert(result.kind === 'deny', '3 failures >= 3 threshold → deny')
  assert(result.kind === 'deny' && result.reason.includes('bash'), 'deny reason should name the tool')
  store.close()
})

test('guardTool only counts failures containing the specific tool', () => {
  const store = new ExperienceStore()
  seedFailedTool(store, 'bash', 't1')
  seedFailedTool(store, 'bash', 't2')
  seedFailedTool(store, 'bash', 't3')
  // "write" never appears in any failed experience
  const result = guardTool('write', store, 1)
  assert(result.kind === 'allow', 'write not in failed experiences → allow even at threshold 1')
  store.close()
})

console.log(`\n${passed} passed, ${failed} failed\n`)

if (failed > 0) process.exit(1)
