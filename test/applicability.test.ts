/**
 * Lesson applicability (mu8-condition) tests — 反馈结构条件化。
 *
 * 覆盖观测启发式（验证类调用识别、rich/opaque 反馈分类、turn 画像聚合）、
 * lesson 解析（extractApplicability 容错）、生成侧三态 applicability 模板
 * （rule-based fallback），以及合并链条件保留/泛化规则。
 *
 * 背景：mu8 负迁移——「勤验证」元策略在 opaque（黑盒 PASS/FAIL）反馈下
 * 零信息增益空转到超时；条件化的目标是让 lesson 携带其学习环境的反馈结构。
 */

import {
  isVerificationCall,
  isRichFeedback,
  buildFeedbackProfile,
  describeFeedbackProfile,
  extractApplicability,
  type VerificationSample,
} from '../src/types/index.js'
import { buildLessonPrompt, generateStructuredReflection, mergeLessonsRuleBased } from '../src/reflection.js'
import type { ExperienceRecord } from '../src/types/index.js'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`)
}

let passed = 0
let failed = 0

const registeredTests: { name: string; fn: () => void | Promise<void> }[] = []

function test(name: string, fn: () => void | Promise<void>): void {
  registeredTests.push({ name, fn })
}

// ---------------------------------------------------------------------------
// Observation heuristics
// ---------------------------------------------------------------------------

test('isVerificationCall: command shapes are detected', () => {
  assert(isVerificationCall('node test.cjs', ''), 'node test.cjs must be a verification call')
  assert(isVerificationCall('npm test', ''), 'npm test must be a verification call')
  assert(isVerificationCall('yarn run test', ''), 'yarn run test must be a verification call')
  assert(isVerificationCall('python -m pytest tests/', ''), 'pytest must be a verification call')
})

test('isVerificationCall: output shape alone is enough when command is silent', () => {
  assert(isVerificationCall(null, 'FAIL\nexpected 3 to equal 4'), 'FAIL output marks a verification call')
  assert(isVerificationCall(null, '3 tests, 1 failing'), 'Tests: output marks a verification call')
})

test('isVerificationCall: plain exploration output is not verification', () => {
  assert(!isVerificationCall('ls -la', 'README.md\nsrc\ntest/'), 'ls output is not verification')
  assert(!isVerificationCall('cat notes.txt', 'some meeting notes without verdicts'), 'plain text is not verification')
})

test('isRichFeedback: readable failure detail beats bare verdicts', () => {
  assert(isRichFeedback('AssertionError: expected 3 to equal 4\n  at line 12'), 'expected/actual is rich feedback')
  assert(isRichFeedback('FAIL'.repeat(20)), 'long output is rich feedback')
  assert(!isRichFeedback('FAIL'), 'bare FAIL is opaque')
  assert(!isRichFeedback('PASS'), 'bare PASS is opaque')
  assert(!isRichFeedback('hash: a3f5c8…'), 'hash verdict is opaque')
})

test('buildFeedbackProfile: no samples → none', () => {
  const p = buildFeedbackProfile([])
  assert(p.verificationRuns === 0 && p.feedbackStyle === 'none' && p.samples.length === 0, 'empty input classifies as none')
})

test('buildFeedbackProfile: all opaque outputs → opaque', () => {
  const p = buildFeedbackProfile([
    { command: 'node test.cjs', output: 'FAIL', ok: false },
    { command: 'node test.cjs', output: 'PASS', ok: true },
  ])
  assert(p.verificationRuns === 2 && p.feedbackStyle === 'opaque', 'bare verdicts classify as opaque')
})

test('buildFeedbackProfile: one rich output → detailed', () => {
  const p = buildFeedbackProfile([
    { command: 'node test.cjs', output: 'FAIL', ok: false },
    { command: 'node test.cjs', output: 'AssertionError: expected 3 to equal 4 at line 12', ok: false },
  ])
  assert(p.feedbackStyle === 'detailed', 'any rich output classifies the channel as detailed')
  assert(p.samples.length === 2, 'samples render into the profile')
})

test('describeFeedbackProfile: renders human-readable one-liner', () => {
  const none = describeFeedbackProfile(undefined)
  assert(none === 'no verification output observed', 'undefined profile renders as none')
  const opaque = describeFeedbackProfile({ verificationRuns: 3, feedbackStyle: 'opaque', samples: [] })
  assert(opaque.includes('3 verification run(s)') && opaque.includes('opaque'), 'opaque line includes count and style')
})

// ---------------------------------------------------------------------------
// Lesson parsing
// ---------------------------------------------------------------------------

test('extractApplicability: reads the field from lesson JSON', () => {
  const lesson = JSON.stringify({ whatWorked: 'x', reusableLesson: 'y', applicability: 'Applies when feedback is readable' })
  assert(extractApplicability(lesson) === 'Applies when feedback is readable', 'applicability parses from JSON')
})

test('extractApplicability: legacy lessons degrade to null', () => {
  assert(extractApplicability(JSON.stringify({ reusableLesson: 'y' })) === null, 'JSON without applicability → null')
  assert(extractApplicability('plain text legacy lesson') === null, 'plain-text lesson → null')
  assert(extractApplicability(null) === null, 'null lesson → null')
  assert(extractApplicability(JSON.stringify({ applicability: '' })) === null, 'empty applicability → null')
})

// ---------------------------------------------------------------------------
// Rule-based generation (fallback path)
// ---------------------------------------------------------------------------

const baseEntry = {
  actions: JSON.stringify({ tools: [{ name: 'bash', success: true }] }),
  outcomeScore: 0.8,
  userFeedback: 'none',
  toolsUsed: ['bash'],
  stepCount: 5,
  difficulty: 'high' as const,
}

test('generateStructuredReflection: opaque feedback yields the do-not-transfer condition', () => {
  const r = generateStructuredReflection({
    ...baseEntry,
    feedbackProfile: { verificationRuns: 6, feedbackStyle: 'opaque', samples: ['cmd: node test.cjs\n  out: FAIL'] },
  })
  assert(r.applicability !== undefined && r.applicability.includes('opaque'), 'opaque condition states the black-box learning environment')
})

test('generateStructuredReflection: detailed feedback yields the readable-dependency condition', () => {
  const r = generateStructuredReflection({
    ...baseEntry,
    feedbackProfile: { verificationRuns: 2, feedbackStyle: 'detailed', samples: [] },
  })
  assert(r.applicability !== undefined && r.applicability.includes('readable'), 'detailed condition states the readable-feedback dependency')
})

test('generateStructuredReflection: no observation yields the check-first condition', () => {
  const r = generateStructuredReflection({ ...baseEntry, feedbackProfile: { verificationRuns: 0, feedbackStyle: 'none', samples: [] } })
  assert(r.applicability !== undefined && r.applicability.includes('check'), 'unobserved turn yields a verify-before-applying condition')
})

test('generateStructuredReflection: correction branch yields the user-preference condition', () => {
  const r = generateStructuredReflection({ ...baseEntry, correction: 'use Array.from, not charAt' })
  assert(r.applicability !== undefined && r.applicability.includes('User preference'), 'correction condition is user-scoped, not feedback-scoped')
})

test('buildLessonPrompt: carries feedback structure and demands applicability', () => {
  const prompt = buildLessonPrompt({
    ...baseEntry,
    feedbackProfile: { verificationRuns: 3, feedbackStyle: 'opaque', samples: ['cmd: node test.cjs\n  out: FAIL'] },
  })
  assert(prompt.includes('Feedback structure:'), 'prompt states the feedback structure')
  assert(prompt.includes('3 verification run(s)'), 'prompt carries the verification count')
  assert(prompt.includes('Verification output samples:'), 'prompt embeds raw samples for LLM self-correction')
  assert(prompt.includes('"applicability"'), 'output format demands the applicability field')
  assert(prompt.includes('one bit'), 'prompt explains the opaque-channel failure mode')
})

// ---------------------------------------------------------------------------
// Merge chain condition preservation
// ---------------------------------------------------------------------------

const recordWith = (lesson: string): ExperienceRecord => ({
  id: 'x', sessionId: 's', turnId: 't', createdAt: 0, taskUnitId: '', goalId: null,
  contextHash: 'c', contentHash: null, taskPattern: null, toolsUsed: null, workspaceDigest: null,
  actions: '', outcomeScore: 0.5, userFeedback: 'none', lesson,
  difficulty: 'high', generation: 0, lastInjectedAt: null, merged: false,
  tags: null, confidence: 1, reuseCount: 0, source: 'model-inferred',
  transferConfidence: 0.5, semanticKey: null, memoryTier: 'event',
})

test('mergeLessonsRuleBased: uniform conditions carry over verbatim', () => {
  const cond = 'Applies when verification failures produce readable detail'
  const merged = mergeLessonsRuleBased([
    recordWith(JSON.stringify({ reusableLesson: 'a', applicability: cond })),
    recordWith(JSON.stringify({ reusableLesson: 'b', applicability: cond })),
  ])
  assert(merged.applicability === cond, 'identical conditions survive the merge')
})

test('mergeLessonsRuleBased: conflicting conditions degrade explicitly, never silently drop', () => {
  const merged = mergeLessonsRuleBased([
    recordWith(JSON.stringify({ reusableLesson: 'a', applicability: 'readable feedback only' })),
    recordWith(JSON.stringify({ reusableLesson: 'b', applicability: 'opaque pass/fail only' })),
  ])
  assert(merged.applicability !== undefined && merged.applicability.includes('differing'), 'mixed conditions state that they vary')
})

test('mergeLessonsRuleBased: legacy lessons without conditions stay undefined', () => {
  const merged = mergeLessonsRuleBased([
    recordWith('plain legacy lesson'),
    recordWith(JSON.stringify({ reusableLesson: 'b' })),
  ])
  assert(merged.applicability === undefined, 'no source conditions → no invented condition')
})

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function runAllTests(): Promise<void> {
  for (const t of registeredTests) {
    try {
      await t.fn()
      passed++
      console.log(`  ✓ ${t.name}`)
    } catch (err) {
      failed++
      console.error(`  ✗ ${t.name}`)
      console.error(`    ${(err as Error).message}`)
    }
  }
  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
}

void runAllTests()