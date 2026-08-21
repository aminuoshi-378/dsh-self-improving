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

function test(name: string, fn: () => void | Promise<void>): void {
  try {
    const result = fn()
    if (result instanceof Promise) {
      result.then(() => {
        passed++
        console.log(`  ✓ ${name}`)
      }).catch((err) => {
        failed++
        console.error(`  ✗ ${name}`)
        console.error(`    ${err.message}`)
      })
    } else {
      passed++
      console.log(`  ✓ ${name}`)
    }
  } catch (err) {
    failed++
    console.error(`  ✗ ${name}`)
    console.error(`    ${(err as Error).message}`)
  }
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
    outcomeScore: score,
    timestamp: Date.now(),
  }

  return store.store(outcome, {
    taskPattern,
    toolsUsed: tools,
    workspaceDigest: 'digest-1',
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

console.log(`\n${passed} passed, ${failed} failed\n`)
