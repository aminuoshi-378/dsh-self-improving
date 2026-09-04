/**
 * Truth-ground layer tests — v2 (真值信号判定)
 *
 * 覆盖 resolveVerdict 三级回退、hardFactVerdict、proxyPriorVerdict、
 * computeVerdictConfidence，以及 v1 失真的修正（active≠advanced、未知≠满分）。
 */

import {
  resolveVerdict,
  hardFactVerdict,
  proxyPriorVerdict,
} from '../src/truth-ground.js'
import { computeVerdictConfidence } from '../src/types/index.js'
import type { VerdictSource } from '../src/types/index.js'

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

console.log('\n=== Truth-ground Layer Tests ===')

// ---------------------------------------------------------------------------
// computeVerdictConfidence
// ---------------------------------------------------------------------------

test('computeVerdictConfidence maps L0→1.0, L1→0.8, L2→0.6, L3→0.3', () => {
  assertEq(computeVerdictConfidence('L0'), 1.0, 'L0 confidence')
  assertEq(computeVerdictConfidence('L1'), 0.8, 'L1 confidence')
  assertEq(computeVerdictConfidence('L2'), 0.6, 'L2 confidence')
  assertEq(computeVerdictConfidence('L3'), 0.3, 'L3 confidence')
})

// ---------------------------------------------------------------------------
// hardFactVerdict (L2)
// ---------------------------------------------------------------------------

test('hardFactVerdict: any failed tool → fail', () => {
  assertEq(
    hardFactVerdict({ toolResults: [{ name: 'write', success: true }, { name: 'bash', success: false }] }),
    'fail',
    'one failure → fail',
  )
})

test('hardFactVerdict: all success → null (not enough to prove pass)', () => {
  assertEq(
    hardFactVerdict({ toolResults: [{ name: 'write', success: true }] }),
    null,
    'all success → null',
  )
})

test('hardFactVerdict: empty/undefined → null', () => {
  assertEq(hardFactVerdict(undefined), null, 'undefined → null')
  assertEq(hardFactVerdict({ toolResults: [] }), null, 'empty → null')
})

// ---------------------------------------------------------------------------
// proxyPriorVerdict (L3) — v1 distortion fixes
// ---------------------------------------------------------------------------

test('proxyPriorVerdict: complete → pass', () => {
  assertEq(proxyPriorVerdict({ goalPhase: 'complete', toolSuccessRate: 1 }), 'pass', 'complete → pass')
})

test('proxyPriorVerdict: blocked → fail', () => {
  assertEq(proxyPriorVerdict({ goalPhase: 'blocked', toolSuccessRate: 0 }), 'fail', 'blocked → fail')
})

test('proxyPriorVerdict: active → unknown (fixes active→advanced distortion)', () => {
  assertEq(proxyPriorVerdict({ goalPhase: 'active', toolSuccessRate: 1 }), 'unknown', 'active → unknown')
})

test('proxyPriorVerdict: paused → unknown', () => {
  assertEq(proxyPriorVerdict({ goalPhase: 'paused', toolSuccessRate: 1 }), 'unknown', 'paused → unknown')
})

test('proxyPriorVerdict: no goal phase → unknown (not pass, even with high success rate)', () => {
  assertEq(proxyPriorVerdict({ toolSuccessRate: 1 }), 'unknown', 'no phase → unknown')
})

test('proxyPriorVerdict: undefined input → unknown', () => {
  assertEq(proxyPriorVerdict(undefined), 'unknown', 'undefined → unknown')
})

// ---------------------------------------------------------------------------
// resolveVerdict (L0 > L1 > L2 > L3 回退)
// ---------------------------------------------------------------------------

test('resolveVerdict: L0 positive feedback wins over everything', () => {
  const r = resolveVerdict({
    userRating: 'positive',
    llmJudgment: 'fail',
    hardFacts: { toolResults: [{ name: 'bash', success: false }] },
    proxyPrior: { goalPhase: 'blocked', toolSuccessRate: 0 },
  })
  assertEq(r.verdict, 'pass', 'verdict=pass')
  assertEq(r.source as VerdictSource, 'L0', 'source=L0')
  assertEq(r.outcomeConfidence, 1.0, 'confidence=1.0')
})

test('resolveVerdict: L0 negative feedback wins', () => {
  const r = resolveVerdict({
    userRating: 'negative',
    llmJudgment: 'pass',
    proxyPrior: { goalPhase: 'complete', toolSuccessRate: 1 },
  })
  assertEq(r.verdict, 'fail', 'verdict=fail')
  assertEq(r.source as VerdictSource, 'L0', 'source=L0')
})

test('resolveVerdict: L1 judgment used when no L0 feedback', () => {
  const r = resolveVerdict({ llmJudgment: 'pass', proxyPrior: { goalPhase: 'blocked', toolSuccessRate: 0 } })
  assertEq(r.verdict, 'pass', 'verdict=pass')
  assertEq(r.source as VerdictSource, 'L1', 'source=L1')
  assertEq(r.outcomeConfidence, 0.8, 'confidence=0.8')
})

test('resolveVerdict: L1 unknown → falls through to L2/L3', () => {
  const r = resolveVerdict({
    llmJudgment: 'unknown',
    hardFacts: { toolResults: [{ name: 'bash', success: false }] },
  })
  assertEq(r.verdict, 'fail', 'verdict=fail')
  assertEq(r.source as VerdictSource, 'L2', 'source=L2')
})

test('resolveVerdict: L2 hard fail used when no L0/L1', () => {
  const r = resolveVerdict({
    hardFacts: { toolResults: [{ name: 'bash', success: false }] },
    proxyPrior: { goalPhase: 'complete', toolSuccessRate: 0.5 },
  })
  assertEq(r.verdict, 'fail', 'verdict=fail')
  assertEq(r.source as VerdictSource, 'L2', 'source=L2')
})

test('resolveVerdict: L3 proxy prior (complete) used when no stronger signal', () => {
  const r = resolveVerdict({ proxyPrior: { goalPhase: 'complete', toolSuccessRate: 1 } })
  assertEq(r.verdict, 'pass', 'verdict=pass')
  assertEq(r.source as VerdictSource, 'L3', 'source=L3')
})

test('resolveVerdict: no signal at all → unknown (never assume success)', () => {
  const r = resolveVerdict({})
  assertEq(r.verdict, 'unknown', 'verdict=unknown')
  assertEq(r.source as VerdictSource, 'L3', 'source=L3')
  assertEq(r.outcomeConfidence, 0.3, 'confidence=0.3 (weakest)')
})

test('resolveVerdict: active goal phase → unknown, NOT pass (fixes distortion)', () => {
  const r = resolveVerdict({ proxyPrior: { goalPhase: 'active', toolSuccessRate: 1 } })
  assertEq(r.verdict, 'unknown', 'active → unknown')
})

console.log(`\n结果: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)