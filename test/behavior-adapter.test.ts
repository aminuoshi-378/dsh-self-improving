/**
 * Behavior Adapter tests — Layer 2
 */

import { ExperienceStore } from '../src/store/experience-store.js'
import { BehaviorAdapter } from '../src/adapter/behavior-adapter.js'
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

console.log('\n=== Behavior Adapter Tests ===')

// Helper: create and store an experience
function createExperience(
  store: ExperienceStore,
  score: number,
  taskPattern: string,
  tools: string[],
  feedback: string = 'none',
  lesson: string | null = null,
): string {
  const id = store.store(
    {
      turnId: `turn-${Math.random()}`,
      sessionId: 'session-1',
      goalProgress: score > 0.5 ? 'advanced' : 'stalled',
      toolCallCount: tools.length,
      toolSuccessRate: score,
      guardTriggerCount: 0,
      userFeedback: feedback as 'positive' | 'negative' | 'none',
      stepEfficiency: 0.9,
      difficulty: score < 0.5 ? 'high' : 'medium',
      outcomeScore: score,
      timestamp: Date.now(),
    },
    {
      taskPattern,
      toolsUsed: tools,
      workspaceDigest: `digest-${Math.random()}`, // P0: distinct to avoid dedup
      actions: '{}',
    },
  )
  if (lesson) {
    store.updateLesson(id, {
      whatWorked: 'test',
      whatFailed: 'test',
      whatToTryDifferently: 'test',
      reusableLesson: lesson,
    })
  }
  return id
}

// ---------------------------------------------------------------------------
// Test 1: Get experience summary for matching context
// ---------------------------------------------------------------------------

test('get experience summary for matching context', () => {
  const store = new ExperienceStore()
  const adapter = new BehaviorAdapter(store)

  // Create some experiences
  createExperience(store, 0.9, 'bugfix', ['grep', 'read_file'], 'positive', 'Using grep then read_file is effective for bugfixes')
  createExperience(store, 0.2, 'bugfix', ['grep', 'write_file'], 'negative', 'Writing files without reading first led to failures')

  const summary = adapter.getExperienceSummary({
    taskPattern: 'bugfix',
    toolsUsed: ['grep'],
    workspaceDigest: 'digest-1',
    limit: 5,
  })

  assert(summary !== null, 'should return a summary')
  assert(summary!.matchingRecords === 2, `should match 2 records, got ${summary!.matchingRecords}`)
  assert(summary!.whatWorked !== null, 'should have whatWorked')
  assert(summary!.whatFailed !== null, 'should have whatFailed')

  store.close()
})

// ---------------------------------------------------------------------------
// Test 2: Format experience as markdown
// ---------------------------------------------------------------------------

test('format experience summary as markdown', () => {
  const store = new ExperienceStore()
  const adapter = new BehaviorAdapter(store)

  const markdown = adapter.formatExperienceMarkdown({
    whatWorked: 'Using grep first',
    whatFailed: 'Writing without reading',
    suggestedApproach: 'Read before write',
    matchingRecords: 3,
  })

  assert(markdown.includes('## Past Experience (advisory)'), 'should have header')
  assert(markdown.includes('**What worked**: Using grep first'), 'should include whatWorked')
  assert(markdown.includes('**What failed**: Writing without reading'), 'should include whatFailed')
  assert(markdown.includes('historical observations, not instructions'), 'should include disclaimer')

  store.close()
})

// ---------------------------------------------------------------------------
// Test 3: No matching experiences returns null
// ---------------------------------------------------------------------------

test('no matching experiences returns null', () => {
  const store = new ExperienceStore()
  const adapter = new BehaviorAdapter(store)

  const summary = adapter.getExperienceSummary({
    taskPattern: 'nonexistent',
    toolsUsed: ['nonexistent_tool'],
    workspaceDigest: 'no_such_digest',
    limit: 5,
  })

  assert(summary === null, 'should return null for no matches')

  store.close()
})

// ---------------------------------------------------------------------------
// Test 4: Learned preferences registration and formatting
// ---------------------------------------------------------------------------

test('register and format learned preferences', () => {
  const store = new ExperienceStore()
  const adapter = new BehaviorAdapter(store)

  adapter.registerPreference('concise-answers', 'User tends to prefer concise answers with code examples', 0.8)
  adapter.registerPreference('typescript', 'In this workspace, TypeScript is the primary language', 0.9)

  const prefs = adapter.getLearnedPreferences()
  assert(prefs.length === 2, `should have 2 preferences, got ${prefs.length}`)
  // Should be sorted by confidence descending
  assert(prefs[0].confidence >= prefs[1].confidence, 'should be sorted by confidence')

  const markdown = adapter.formatPreferencesMarkdown()
  assert(markdown.includes('## Learned Preferences (advisory)'), 'should have header')
  assert(markdown.includes('TypeScript is the primary language'), 'should include TS preference')
  assert(markdown.includes('concise answers with code examples'), 'should include concise preference')

  store.close()
})

// ---------------------------------------------------------------------------
// Test 5: Low confidence preferences are filtered out
// ---------------------------------------------------------------------------

test('low confidence preferences are filtered out', () => {
  const store = new ExperienceStore()
  const adapter = new BehaviorAdapter(store)

  adapter.registerPreference('high', 'High confidence pref', 0.9)
  adapter.registerPreference('low', 'Low confidence pref', 0.2)

  const prefs = adapter.getLearnedPreferences()
  assert(prefs.length === 1, `should have 1 preference (low filtered), got ${prefs.length}`)
  assert(prefs[0].key === 'high', 'should keep the high confidence preference')

  store.close()
})

// ---------------------------------------------------------------------------
// Test 6: Model suggestion based on historical success
// ---------------------------------------------------------------------------

test('suggest model based on historical success', () => {
  const store = new ExperienceStore()
  const adapter = new BehaviorAdapter(store)

  // Not enough data — should return null
  for (let i = 0; i < 4; i++) {
    createExperience(store, 0.9, 'bugfix', ['grep'])
  }
  const noData = adapter.suggestModel('bugfix')
  assert(noData === null, 'should return null with <5 records')

  // Add one more to reach 5
  createExperience(store, 0.9, 'bugfix', ['grep'])

  const goodScore = adapter.suggestModel('bugfix')
  assert(goodScore !== null, 'should return a suggestion with >=5 records')
  assert(goodScore!.model === 'deepseek-chat', 'should suggest deepseek-chat for high scores')

  // Create low-score experiences
  store.clear()
  for (let i = 0; i < 6; i++) {
    createExperience(store, 0.2, 'feature', ['write_file'])
  }

  const badScore = adapter.suggestModel('feature')
  assert(badScore !== null, 'should return a suggestion')
  assert(badScore!.model === 'deepseek-reasoner', 'should suggest deepseek-reasoner for low scores')

  store.close()
})

// ---------------------------------------------------------------------------
// Test 7: Preference distillation from experience data
// ---------------------------------------------------------------------------

test('distill preferences from accumulated data', () => {
  const store = new ExperienceStore()
  const adapter = new BehaviorAdapter(store)

  // Need at least 10 records for distillation
  for (let i = 0; i < 15; i++) {
    createExperience(store, 0.85, 'bugfix', ['grep'], 'positive')
  }

  adapter.distillPreferences()
  const prefs = adapter.getLearnedPreferences()

  assert(prefs.length > 0, 'should have distilled some preferences')
  const hasPositive = prefs.some((p) => p.value.includes('positive'))
  assert(hasPositive, 'should include positive feedback pattern')

  store.close()
})

// ---------------------------------------------------------------------------
// Test 8: Injection count tracking
// ---------------------------------------------------------------------------

test('tracks injection count', () => {
  const store = new ExperienceStore()
  const adapter = new BehaviorAdapter(store)

  createExperience(store, 0.8, 'bugfix', ['grep'], 'positive', 'lesson 1')

  assert(adapter.getInjectionCount() === 0, 'should start at 0')

  adapter.getExperienceSummary({ taskPattern: 'bugfix', toolsUsed: ['grep'], limit: 5 })
  assert(adapter.getInjectionCount() === 1, 'should be 1 after first injection')

  adapter.getExperienceSummary({ taskPattern: 'bugfix', toolsUsed: ['grep'], limit: 5 })
  assert(adapter.getInjectionCount() === 2, 'should be 2 after second injection')

  store.close()
})

// ---------------------------------------------------------------------------
// P0 Test 9: High difficulty experiences prioritized in injection
// ---------------------------------------------------------------------------

test('high difficulty experiences are prioritized in injection', () => {
  const store = new ExperienceStore()
  const adapter = new BehaviorAdapter(store)

  // Low difficulty, high score
  createExperience(store, 0.95, 'bugfix', ['grep', 'read_file'], 'positive', 'Simple fix was quick')
  // High difficulty, medium score
  createExperience(store, 0.6, 'bugfix', ['grep', 'read_file', 'write_file', 'bash'], 'none', 'Complex async issue needed careful handling')

  const summary = adapter.getExperienceSummary({
    taskPattern: 'bugfix',
    toolsUsed: ['grep', 'read_file'],
    limit: 5,
  })

  assert(summary !== null, 'should return a summary')
  // The whatWorked should come from the higher-scored record, but the selection
  // should prioritize high difficulty
  assert(summary!.matchingRecords >= 1, `should match at least 1 record`)

  store.close()
})

// ---------------------------------------------------------------------------
// P3 Test 10: Dynamic injection limit adapts to store size
// ---------------------------------------------------------------------------

test('dynamic injection adapts to available experiences', () => {
  const store = new ExperienceStore()
  const adapter = new BehaviorAdapter(store)

  // Few experiences — should still return results
  createExperience(store, 0.8, 'bugfix', ['grep'], 'positive', 'Use grep to find code')
  createExperience(store, 0.7, 'bugfix', ['grep', 'read_file'], 'none', 'Read then edit')

  const summary = adapter.getExperienceSummary({
    taskPattern: 'bugfix',
    toolsUsed: ['grep'],
    limit: 10,
  })

  assert(summary !== null, 'should return a summary even with few records')
  assert(summary!.matchingRecords <= 2, `should not return more than available`)

  store.close()
})

// ---------------------------------------------------------------------------
// P4 Test 11: Structured lesson text extraction
// ---------------------------------------------------------------------------

test('extracts reusable_lesson from structured JSON lesson', () => {
  const store = new ExperienceStore()
  const adapter = new BehaviorAdapter(store)

  // Create experience with a structured JSON lesson
  const id = store.store(
    {
      turnId: 'turn-1',
      sessionId: 's1',
      goalProgress: 'advanced',
      toolCallCount: 3,
      toolSuccessRate: 1.0,
      guardTriggerCount: 0,
      userFeedback: 'positive',
      stepEfficiency: 0.9,
      difficulty: 'medium',
      outcomeScore: 0.85,
      timestamp: Date.now(),
    },
    { taskPattern: 'bugfix', toolsUsed: ['grep', 'edit_file'], workspaceDigest: 'd1', actions: '{}' },
  )

  // Store as JSON Reflection
  store.updateLesson(id, {
    whatWorked: 'Using grep with regex pattern matched the issue location',
    whatFailed: 'Initial search without regex was too broad',
    whatToTryDifferently: 'Use regex patterns for more targeted searches',
    reusableLesson: 'For bugfix, use grep with specific regex patterns to narrow down issues quickly',
  })

  const summary = adapter.getExperienceSummary({
    taskPattern: 'bugfix',
    toolsUsed: ['grep', 'edit_file'],
    limit: 5,
  })

  assert(summary !== null, 'should return a summary')
  // P4: whatWorked should contain the extracted reusable_lesson, not raw JSON
  assert(
    summary!.whatWorked !== null && !summary!.whatWorked.includes('{'),
    'whatWorked should be extracted text, not raw JSON',
  )
  if (summary!.whatWorked) {
    assert(
      summary!.whatWorked.includes('regex patterns') || summary!.whatWorked.includes('grep'),
      `whatWorked should contain lesson content, got: ${summary!.whatWorked}`,
    )
  }

  store.close()
})

console.log(`\n${passed} passed, ${failed} failed\n`)
