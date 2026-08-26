/**
 * Meta-Cognition Engine tests — Layer 4
 */

import { ExperienceStore } from '../src/store/experience-store.js'
import { MetaCognitionEngine, type LLMClient } from '../src/meta-cognition/meta-cognition-engine.js'
import type { TurnOutcome } from '../src/types/index.js'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`)
}

let passed = 0
let failed = 0

const testQueue: Promise<void>[] = []

function test(name: string, fn: () => void | Promise<void>): void {
  const p = Promise.resolve().then(() => fn()).then(() => {
    passed++
    console.log(`  ✓ ${name}`)
  }).catch((err) => {
    failed++
    console.error(`  ✗ ${name}`)
    console.error(`    ${err.message}`)
  })
  testQueue.push(p)
}

async function runAll(): Promise<void> {
  await Promise.all(testQueue)
  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
}

console.log('\n=== Meta-Cognition Engine Tests ===')

// Mock LLM client
class MockLLMClient implements LLMClient {
  public lastPrompt: string = ''
  public shouldFail: boolean = false

  async complete(prompt: string): Promise<string> {
    this.lastPrompt = prompt
    if (this.shouldFail) throw new Error('Mock LLM failure')

    return JSON.stringify({
      what_worked: 'The tool selection was appropriate for the task',
      what_failed: 'The execution took too many steps',
      what_to_try_differently: 'Consider batching tool calls for efficiency',
      reusable_lesson: 'When doing bugfix, use grep to locate the file first, then read the specific lines',
    })
  }
}

// Helper: create and store an experience
function createAndStoreExperience(
  store: ExperienceStore,
  score: number,
  taskPattern: string = 'bugfix',
  tools: string[] = ['grep', 'read_file'],
  feedback: string = 'positive',
): string {
  const outcome: TurnOutcome = {
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
  }

  return store.store(outcome, {
    taskPattern,
    toolsUsed: tools,
    workspaceDigest: `digest-${Math.random()}`,
    actions: JSON.stringify({
      tools: tools.map((t) => ({ tool: t, ok: score > 0.5, ms: 100 })),
      guards: [],
      goalProgress: outcome.goalProgress,
      feedback,
    }),
  })
}

// ---------------------------------------------------------------------------
// Test 1: Queue reflection and process with LLM
// ---------------------------------------------------------------------------

test('queue and process reflection with LLM', async () => {
  const store = new ExperienceStore()
  const llm = new MockLLMClient()
  const engine = new MetaCognitionEngine(store, llm)

  const id = createAndStoreExperience(store, 0.85)

  engine.queueReflection({
    experienceId: id,
    turnId: 'turn-1',
    sessionId: 'session-1',
    actions: '{"tools":[{"tool":"grep","ok":true,"ms":100}],"guards":[]}',
    outcomeScore: 0.85,
    userFeedback: 'positive',
  })

  assert(engine.getPendingCount() === 1, `should have 1 pending, got ${engine.getPendingCount()}`)

  const processed = await engine.processQueue()

  assert(processed === 1, `should process 1, got ${processed}`)
  assert(engine.getPendingCount() === 0, 'should have 0 pending after processing')
  assert(engine.getReflectionCount() === 1, 'reflection count should be 1')

  // The lesson should be written to the store
  const rec = store.getById(id)
  assert(rec !== null, 'record should exist')
  assert(rec!.lesson !== null, 'lesson should be set')
  assert(
    rec!.lesson!.includes('grep to locate the file first'),
    `lesson should contain LLM output, got: ${rec!.lesson}`,
  )

  store.close()
})

// ---------------------------------------------------------------------------
// Test 2: Rule-based fallback when no LLM
// ---------------------------------------------------------------------------

test('rule-based fallback when no LLM', async () => {
  const store = new ExperienceStore()
  const engine = new MetaCognitionEngine(store, null) // no LLM

  const id = createAndStoreExperience(store, 0.85, 'bugfix', ['grep', 'read_file'], 'positive')

  engine.queueReflection({
    experienceId: id,
    turnId: 'turn-2',
    sessionId: 'session-1',
    actions: JSON.stringify({
      tools: [
        { tool: 'grep', ok: true, ms: 100 },
        { tool: 'read_file', ok: true, ms: 200 },
      ],
      guards: [],
      goalProgress: 'advanced',
      feedback: 'positive',
    }),
    outcomeScore: 0.85,
    userFeedback: 'positive',
  })

  await engine.processQueue()

  const rec = store.getById(id)
  assert(rec!.lesson !== null, 'lesson should be set even without LLM')
  assert(
    rec!.lesson!.includes('0.85'),
    `lesson should mention score, got: ${rec!.lesson}`,
  )

  store.close()
})

// ---------------------------------------------------------------------------
// Test 3: LLM failure falls back to rule-based
// ---------------------------------------------------------------------------

test('LLM failure falls back to rule-based', async () => {
  const store = new ExperienceStore()
  const llm = new MockLLMClient()
  llm.shouldFail = true
  const engine = new MetaCognitionEngine(store, llm)

  const id = createAndStoreExperience(store, 0.3, 'feature', ['write_file'], 'negative')

  engine.queueReflection({
    experienceId: id,
    turnId: 'turn-3',
    sessionId: 'session-1',
    actions: JSON.stringify({
      tools: [{ tool: 'write_file', ok: false, ms: 500 }],
      guards: [{ guard: 'repeat-tool-reminder', reason: 'repeat' }],
      goalProgress: 'stalled',
      feedback: 'negative',
    }),
    outcomeScore: 0.3,
    userFeedback: 'negative',
  })

  await engine.processQueue()

  const rec = store.getById(id)
  assert(rec!.lesson !== null, 'lesson should be set despite LLM failure')
  assert(
    rec!.lesson!.includes('poor') || rec!.lesson!.includes('Poor'),
    `rule-based lesson should mention poor outcome, got: ${rec!.lesson}`,
  )

  store.close()
})

// ---------------------------------------------------------------------------
// Test 4: Disabled engine does nothing
// ---------------------------------------------------------------------------

test('disabled engine does nothing', async () => {
  const store = new ExperienceStore()
  const engine = new MetaCognitionEngine(store, null)

  engine.setEnabled(false)

  const id = createAndStoreExperience(store, 0.8)

  engine.queueReflection({
    experienceId: id,
    turnId: 'turn-4',
    sessionId: 'session-1',
    actions: '{}',
    outcomeScore: 0.8,
    userFeedback: 'positive',
  })

  // queueReflection should be a no-op when disabled
  assert(engine.getPendingCount() === 0, 'should have 0 pending when disabled')

  const processed = await engine.processQueue()
  assert(processed === 0, 'should process 0 when disabled')

  const rec = store.getById(id)
  assert(rec!.lesson === null, 'lesson should not be set when disabled')

  store.close()
})

// ---------------------------------------------------------------------------
// Test 5: Positive outcome boosts confidence on similar experiences
// ---------------------------------------------------------------------------

test('positive outcome boosts confidence on similar experiences', async () => {
  const store = new ExperienceStore()
  const engine = new MetaCognitionEngine(store, null)

  // Create several existing experiences with lessons
  const ids: string[] = []
  for (let i = 0; i < 5; i++) {
    const id = createAndStoreExperience(store, 0.8 + i * 0.01, 'bugfix', ['grep'])
    store.updateLesson(id, {
      whatWorked: 'test',
      whatFailed: 'test',
      whatToTryDifferently: 'test',
      reusableLesson: `lesson ${i}`,
    })
    ids.push(id)
  }

  // Decay confidence on some
  store.incrementReuse(ids[0])
  store.incrementReuse(ids[0])
  store.incrementReuse(ids[1])
  store.incrementReuse(ids[1])
  store.incrementReuse(ids[1])

  const before0 = store.getById(ids[0])
  const before1 = store.getById(ids[1])

  // Queue a high-score reflection
  engine.queueReflection({
    experienceId: ids[4], // the new positive experience
    turnId: 'turn-5',
    sessionId: 'session-1',
    actions: '{}',
    outcomeScore: 0.85,
    userFeedback: 'positive',
  })

  await engine.processQueue()

  const after0 = store.getById(ids[0])
  const after1 = store.getById(ids[1])

  assert(after0!.confidence > before0!.confidence, 'should boost confidence on similar experience 0')
  assert(after1!.confidence > before1!.confidence, 'should boost confidence on similar experience 1')

  store.close()
})

// ---------------------------------------------------------------------------
// Test 6: Reflection prompt contains key data
// ---------------------------------------------------------------------------

test('reflection prompt contains key turn data', async () => {
  const store = new ExperienceStore()
  const llm = new MockLLMClient()
  const engine = new MetaCognitionEngine(store, llm)

  const id = createAndStoreExperience(store, 0.5, 'refactoring', ['edit_file'], 'none')

  engine.queueReflection({
    experienceId: id,
    turnId: 'turn-6',
    sessionId: 'session-test-123',
    actions: '{"tools":[{"tool":"edit_file","ok":true,"ms":200}]}',
    outcomeScore: 0.5,
    userFeedback: 'none',
  })

  await engine.processQueue()

  assert(llm.lastPrompt.includes('session-test-123'), 'prompt should contain session id')
  assert(llm.lastPrompt.includes('turn-6'), 'prompt should contain turn id')
  assert(llm.lastPrompt.includes('0.50'), 'prompt should contain score')
  assert(llm.lastPrompt.includes('edit_file'), 'prompt should contain tool name')
  assert(llm.lastPrompt.includes('reusable_lesson'), 'prompt should ask for reusable_lesson')

  store.close()
})

// ---------------------------------------------------------------------------
// Test 7: Empty queue processes nothing
// ---------------------------------------------------------------------------

test('empty queue processes nothing', async () => {
  const store = new ExperienceStore()
  const engine = new MetaCognitionEngine(store, null)

  const processed = await engine.processQueue()
  assert(processed === 0, `should process 0 from empty queue, got ${processed}`)

  store.close()
})

// ---------------------------------------------------------------------------
// Test 8: Get records needing reflection
// ---------------------------------------------------------------------------

test('get records needing reflection', () => {
  const store = new ExperienceStore()
  const engine = new MetaCognitionEngine(store, null)

  // Create records without lessons
  const id1 = createAndStoreExperience(store, 0.8, 'bugfix', ['grep'])
  const id2 = createAndStoreExperience(store, 0.6, 'bugfix', ['grep'])
  const id3 = createAndStoreExperience(store, 0.4, 'feature', ['write_file'])

  // Add a lesson to one record
  store.updateLesson(id2, {
    whatWorked: '',
    whatFailed: '',
    whatToTryDifferently: '',
    reusableLesson: 'already has a lesson',
  })

  const needsReflection = engine.getRecordsNeedingReflection(10)
  assert(needsReflection.length === 2, `should find 2 records without lessons, got ${needsReflection.length}`)
  assert(
    !needsReflection.some((r) => r.id === id2),
    'should not include the record that already has a lesson',
  )

  store.close()
})

// ---------------------------------------------------------------------------
// P4 Test 9: Lesson is stored as structured JSON (Reflection)
// ---------------------------------------------------------------------------

test('lesson is stored as structured JSON after reflection', async () => {
  const store = new ExperienceStore()
  const engine = new MetaCognitionEngine(store, null)

  const id = createAndStoreExperience(store, 0.85, 'bugfix', ['grep', 'read_file'], 'positive')

  engine.queueReflection({
    experienceId: id,
    turnId: 'turn-1',
    sessionId: 'session-1',
    actions: JSON.stringify({
      tools: [
        { tool: 'grep', ok: true, ms: 100 },
        { tool: 'read_file', ok: true, ms: 200 },
      ],
      guards: [],
      goalProgress: 'advanced',
      feedback: 'positive',
    }),
    outcomeScore: 0.85,
    userFeedback: 'positive',
    toolsUsed: ['grep', 'read_file'],
    stepCount: 2,
    difficulty: 'low',
  })

  await engine.processQueue()

  const rec = store.getById(id)
  assert(rec!.lesson !== null, 'lesson should be set')

  // P4: lesson should be parseable as JSON with Reflection fields
  const lessonData = JSON.parse(rec!.lesson!)
  assert(lessonData.whatWorked !== undefined, 'should have whatWorked field')
  assert(lessonData.whatFailed !== undefined, 'should have whatFailed field')
  assert(lessonData.whatToTryDifferently !== undefined, 'should have whatToTryDifferently field')
  assert(lessonData.reusableLesson !== undefined, 'should have reusableLesson field')
  assert(
    typeof lessonData.reusableLesson === 'string' && lessonData.reusableLesson.length > 0,
    'reusableLesson should be a non-empty string',
  )

  store.close()
})

// ---------------------------------------------------------------------------
// P2 Test 10: Lesson merging consolidates similar lessons
// ---------------------------------------------------------------------------

test('lesson merging consolidates similar lessons', async () => {
  const store = new ExperienceStore()

  // Create many similar experiences with lessons
  const ids: string[] = []
  for (let i = 0; i < 25; i++) {
    const id = store.store(
      {
        turnId: `turn-${i}`,
        sessionId: 'session-1',
        goalProgress: 'advanced',
        toolCallCount: 3,
        toolSuccessRate: 0.9,
        guardTriggerCount: 0,
        userFeedback: 'positive',
        stepEfficiency: 0.9,
        difficulty: 'high',
        outcomeScore: 0.8,
        timestamp: Date.now() + i,
      },
      {
        taskPattern: 'bugfix',
        toolsUsed: ['grep', 'read_file', 'edit_file'],
        workspaceDigest: `ws-${i}`,
        actions: '{}',
      },
    )
    store.updateLesson(id, {
      whatWorked: `Approach ${i} worked`,
      whatFailed: `Issue ${i} occurred`,
      whatToTryDifferently: `Try ${i}`,
      reusableLesson: `Lesson ${i}: use grep to find the issue`,
    })
    ids.push(id)
  }

  // Check that lesson groups can be detected
  const groups = store.getUnmergedLessonGroups()
  assert(groups.length > 0, `should find at least 1 group, got ${groups.length}`)
  assert(groups[0].records.length >= 2, 'group should have multiple records')

  // Merge lessons
  const mergeResult = store.mergeLessons(
    groups[0].records.map((r) => r.id),
    {
      whatWorked: 'Consolidated: grep is effective for finding issues',
      whatFailed: 'Various issues occurred',
      whatToTryDifferently: 'Use grep with more specific patterns',
      reusableLesson: 'For bugfix tasks, always start with grep to locate the issue, then read and edit',
    },
    'high',
    ['grep', 'read_file', 'edit_file'],
  )

  assert(mergeResult.length > 0, 'should return a new merged record id')

  // Original records should be marked as merged
  for (const id of groups[0].records.map((r) => r.id)) {
    const rec = store.getById(id)
    assert(rec!.merged === true, `record ${id} should be marked as merged`)
  }

  // Merged record should be in old gen
  const merged = store.getById(mergeResult)
  assert(merged !== null, 'merged record should exist')
  assert(merged!.generation === 1, 'merged record should be in old gen')

  store.close()
})

// ---------------------------------------------------------------------------
// P2 Test 11: Reflection prompt includes step count and difficulty
// ---------------------------------------------------------------------------

test('reflection prompt includes step count and difficulty', async () => {
  const store = new ExperienceStore()
  const llm = new MockLLMClient()
  const engine = new MetaCognitionEngine(store, llm)

  const id = createAndStoreExperience(store, 0.5, 'bugfix', ['grep'], 'none')

  engine.queueReflection({
    experienceId: id,
    turnId: 'turn-7',
    sessionId: 'session-step-test',
    actions: '{"tools":[{"tool":"grep","ok":true,"ms":100}]}',
    outcomeScore: 0.5,
    userFeedback: 'none',
    toolsUsed: ['grep'],
    stepCount: 7,
    difficulty: 'high',
  })

  await engine.processQueue()

  assert(llm.lastPrompt.includes('session-step-test'), 'prompt should contain session id')
  assert(llm.lastPrompt.includes('Steps: 7'), `prompt should contain step count, got: ${llm.lastPrompt}`)
  assert(llm.lastPrompt.includes('Difficulty: high'), `prompt should contain difficulty`)

  store.close()
})

runAll()
