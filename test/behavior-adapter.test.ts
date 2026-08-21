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
      outcomeScore: score,
      timestamp: Date.now(),
    },
    {
      taskPattern,
      toolsUsed: tools,
      workspaceDigest: 'digest-1',
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

console.log(`\n${passed} passed, ${failed} failed\n`)
