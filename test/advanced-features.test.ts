/**
 * Advanced features tests — A1/A2/A3/A5/B1/B2/E2
 *
 * Tests for features added after P0-P5:
 * - A1: User preference extraction
 * - A2: TTL expiry
 * - A3: Atomic facts table + FTS5
 * - A5: Active forgetting
 * - B1: Source weights
 * - B2: Conflict detection + eviction
 * - E2: content_hash dedup
 */

import { ExperienceStore } from '../src/store/experience-store.js'
import type { TurnOutcome } from '../src/types/index.js'
import { computeStepEfficiency, computeDifficulty, extractLessonText, inferTaskPattern } from '../src/types/index.js'
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'

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
    outcomeScore: 0.85,
    timestamp: Date.now(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Helper: extractPreference + appendPreference (copied from index.ts since they're not exported)
// ---------------------------------------------------------------------------

const PREFERENCE_TRIGGERS = [
  /(?:请记住|记住|以后总是|我偏好|我喜欢|我习惯于|请确保|务必|remember\s+(?:that\s+)?(?:I|that)\s+(?:prefer|like|always|usually)|from\s+now\s+on)\s*[:：]?\s*(.+)/i,
  /(?:偏好|习惯|要求|规则)\s*[:：]\s*(.+)/i,
]
const PREFERENCE_STOPWORDS = /^(?:帮我|请帮|能不能|可以|帮我修|帮我写|帮我查|帮我找|create|edit|fix|write|read|search|find)\b/i

function extractPreference(userText: string): string | null {
  if (!userText || userText.length < 8) return null
  if (PREFERENCE_STOPWORDS.test(userText.trim())) return null
  for (const pattern of PREFERENCE_TRIGGERS) {
    const match = userText.match(pattern)
    if (match && match[1]) {
      const pref = match[1].trim()
      if (pref.length >= 2 && pref.length <= 200) return pref
    }
  }
  return null
}

function readPreferences(filePath: string): string {
  try {
    if (!existsSync(filePath)) return ''
    return readFileSync(filePath, 'utf-8').trim()
  } catch { return '' }
}

function appendPreference(filePath: string, preference: string): boolean {
  const existing = readPreferences(filePath)
  const normalized = preference.toLowerCase().trim()
  if (existing && existing.toLowerCase().includes(normalized)) return false
  const line = '- ' + preference
  let content: string
  if (!existing) content = '# User Preferences (advisory)\n\n' + line + '\n'
  else content = existing + '\n' + line + '\n'
  try { mkdirSync(dirname(filePath), { recursive: true }); writeFileSync(filePath, content, 'utf-8'); return true } catch { return false }
}

console.log('\n=== Advanced Features Tests ===')

// ---------------------------------------------------------------------------
// A1: User preference extraction
// ---------------------------------------------------------------------------

console.log('\n--- A1: User Preference Extraction ---')

test('A1: extract Chinese preference "请记住我偏好简洁回答"', () => {
  const pref = extractPreference('请记住我偏好简洁回答')
  assert(pref !== null, 'should extract a preference')
  assert(pref === '我偏好简洁回答', `expected "我偏好简洁回答", got "${pref}"`)
})

test('A1: extract Chinese preference "以后总是用TypeScript"', () => {
  const pref = extractPreference('以后总是用TypeScript写代码')
  assert(pref !== null, 'should extract')
  assert(pref === '用TypeScript写代码', `got "${pref}"`)
})

test('A1: extract English preference "remember I prefer concise answers"', () => {
  const pref = extractPreference('remember I prefer concise answers')
  assert(pref !== null, 'should extract')
  assert(pref === 'concise answers', `got "${pref}"`)
})

test('A1: reject task instruction "帮我修这个bug"', () => {
  const pref = extractPreference('帮我修这个bug')
  assert(pref === null, 'should reject task instruction')
})

test('A1: reject too-short message', () => {
  const pref = extractPreference('你好')
  assert(pref === null, 'should reject short message')
})

test('A1: appendPreference deduplicates', () => {
  const testFile = '/tmp/test-prefs-dedup.md'
  try { unlinkSync(testFile) } catch {}
  assert(appendPreference(testFile, '简洁回答') === true, 'first write should succeed')
  assert(appendPreference(testFile, 'TypeScript') === true, 'second write should succeed')
  assert(appendPreference(testFile, '简洁回答') === false, 'duplicate should be rejected')
  const content = readPreferences(testFile)
  assert(content.includes('简洁回答'), 'should contain first pref')
  assert(content.includes('TypeScript'), 'should contain second pref')
  assert(!content.includes('简洁回答\n- TypeScript\n- 简洁回答'), 'should not have duplicate')
  unlinkSync(testFile)
})

// ---------------------------------------------------------------------------
// E2: content_hash dedup
// ---------------------------------------------------------------------------

console.log('\n--- E2: content_hash Dedup ---')

test('E2: same tool sequence + same success/failure → same content_hash', () => {
  const store = new ExperienceStore()
  const actions = JSON.stringify({ tools: [{ name: 'grep', success: true }, { name: 'edit_file', success: false }] })
  // Compute content_hash the same way the store does
  const tools = [{ name: 'grep', success: true }, { name: 'edit_file', success: false }]
  const toolStr = tools.map((t) => `${t.name}:${t.success}`).join(',')
  const expectedHash = createHash('sha1').update(`${toolStr}|ws-1`).digest('hex').slice(0, 16)

  store.store(makeOutcome({ outcomeScore: 0.6, timestamp: Date.now() - 1000 }), {
    taskPattern: 'bugfix', toolsUsed: ['grep', 'edit_file'], workspaceDigest: 'ws-1', actions,
  })
  store.store(makeOutcome({ outcomeScore: 0.9, timestamp: Date.now() }), {
    taskPattern: 'bugfix', toolsUsed: ['grep', 'edit_file'], workspaceDigest: 'ws-1', actions,
  })

  const results = store.query({ limit: 10, minScore: 0.0 })
  // Should dedup to 1 record (same content_hash)
  assert(results.length === 1, `should dedup to 1, got ${results.length}`)
  assert(results[0].outcomeScore === 0.9, 'should keep highest score')
  store.close()
})

test('E2: same tools but different success/failure → different content_hash', () => {
  const store = new ExperienceStore()
  const actionsAllSuccess = JSON.stringify({ tools: [{ name: 'grep', success: true }, { name: 'edit_file', success: true }] })
  const actionsOneFail = JSON.stringify({ tools: [{ name: 'grep', success: true }, { name: 'edit_file', success: false }] })

  store.store(makeOutcome({ outcomeScore: 0.9, timestamp: Date.now() - 1000 }), {
    taskPattern: 'bugfix', toolsUsed: ['grep', 'edit_file'], workspaceDigest: 'ws-1', actions: actionsAllSuccess,
  })
  store.store(makeOutcome({ outcomeScore: 0.6, timestamp: Date.now() }), {
    taskPattern: 'bugfix', toolsUsed: ['grep', 'edit_file'], workspaceDigest: 'ws-1', actions: actionsOneFail,
  })

  const results = store.query({ limit: 10, minScore: 0.0 })
  assert(results.length === 2, `different content_hash should not dedup, got ${results.length}`)
  store.close()
})

test('E2: content_hash is null for non-JSON actions (fallback to context_hash)', () => {
  const store = new ExperienceStore()
  store.store(makeOutcome({ outcomeScore: 0.7 }), {
    taskPattern: 'bugfix', toolsUsed: ['grep'], workspaceDigest: 'ws-1', actions: 'plain text actions',
  })
  const results = store.query({ limit: 10, minScore: 0.0 })
  assert(results.length === 1, 'should have 1 record')
  assert(results[0].contentHash === null, 'contentHash should be null for non-JSON actions')
  store.close()
})

// ---------------------------------------------------------------------------
// A5: Active forgetting
// ---------------------------------------------------------------------------

console.log('\n--- A5: Active Forgetting ---')

test('A5: low-value experience is proactively forgotten', () => {
  const store = new ExperienceStore()
  // Insert a low-value experience: score=0.2, difficulty=low, no lesson, confidence starts at 1.0
  // activeForget requires confidence < 0.2, so we need to decay it first
  const id = store.store(makeOutcome({ outcomeScore: 0.2, difficulty: 'low' }), {
    taskPattern: 'general', toolsUsed: ['read_file'], workspaceDigest: 'ws-1',
    actions: JSON.stringify({ tools: [{ name: 'read_file', success: true }] }),
  })

  // Decay confidence by incrementing reuse count multiple times
  // N2: confidence = MAX(0.1, 1.0 * 0.9^n)
  // After 17 reuses: 0.9^17 = 0.167 < 0.2
  for (let i = 0; i < 17; i++) {
    store.incrementReuse(id)
  }

  // Now store another experience to trigger enforceRetention → activeForget
  store.store(makeOutcome({ outcomeScore: 0.9 }), {
    taskPattern: 'bugfix', toolsUsed: ['grep', 'edit_file'], workspaceDigest: 'ws-1',
    actions: JSON.stringify({ tools: [{ name: 'grep', success: true }, { name: 'edit_file', success: true }] }),
  })

  // The low-value experience should be forgotten
  const rec = store.getById(id)
  assert(rec === null, 'low-value experience should be actively forgotten')
  store.close()
})

test('A5: high-difficulty experience is NOT forgotten even with low score', () => {
  const store = new ExperienceStore()
  const id = store.store(makeOutcome({ outcomeScore: 0.2, difficulty: 'high' }), {
    taskPattern: 'bugfix', toolsUsed: ['grep', 'edit_file', 'bash', 'write_file', 'read_file', 'edit_file', 'bash', 'grep'],
    workspaceDigest: 'ws-1',
    actions: JSON.stringify({ tools: [{ name: 'grep', success: false }] }),
  })

  // Decay confidence
  for (let i = 0; i < 9; i++) {
    store.incrementReuse(id)
  }

  // Trigger activeForget by storing another
  store.store(makeOutcome({ outcomeScore: 0.9 }), {
    taskPattern: 'bugfix', toolsUsed: ['grep'], workspaceDigest: 'ws-2',
    actions: JSON.stringify({ tools: [{ name: 'grep', success: true }] }),
  })

  const rec = store.getById(id)
  assert(rec !== null, 'high-difficulty experience should NOT be forgotten')
  store.close()
})

// ---------------------------------------------------------------------------
// A2: TTL expiry
// ---------------------------------------------------------------------------

console.log('\n--- A2: TTL Expiry ---')

test('A2: stale old-gen experience downgraded to young-gen after TTL', () => {
  const store = new ExperienceStore()
  const id = store.store(makeOutcome({ outcomeScore: 0.85 }), {
    taskPattern: 'bugfix', toolsUsed: ['grep', 'edit_file'], workspaceDigest: 'ws-1',
    actions: JSON.stringify({ tools: [{ name: 'grep', success: true }, { name: 'edit_file', success: true }] }),
  })
  store.incrementReuse(id)
  store.promoteToOldGen(id) // directly promote to old gen

  // Verify it's in old gen
  let rec = store.getById(id)
  assert(rec !== null, 'record should exist')
  assert(rec!.generation === 1, 'should be in old gen')

  // Simulate TTL: set created_at and last_injected_at to 31 days ago
  const staleTime = Date.now() - 31 * 24 * 60 * 60 * 1000
  store.db.prepare('UPDATE experiences SET created_at = ?, last_injected_at = ? WHERE id = ?')
    .run(staleTime, staleTime, id)

  // Trigger enforceRetention (which calls applyTTL) by storing enough experiences
  // P1: TTL is throttled to run every 10 stores, so we need 10 stores to trigger it
  for (let i = 0; i < 10; i++) {
    store.store(makeOutcome({ outcomeScore: 0.9 }), {
      taskPattern: 'bugfix', toolsUsed: ['grep'], workspaceDigest: `ws-${i}`,
      actions: JSON.stringify({ tools: [{ name: 'grep', success: true }] }),
    })
  }

  // Should be downgraded to young gen (generation=0)
  rec = store.getById(id)
  assert(rec !== null, 'record should still exist')
  assert(rec!.generation === 0, 'should be downgraded to young gen after TTL')
  store.close()
})

test('A2: fresh old-gen experience stays in old gen (within TTL)', () => {
  const store = new ExperienceStore()
  const id = store.store(makeOutcome({ outcomeScore: 0.9 }), {
    taskPattern: 'feature', toolsUsed: ['write_file', 'bash'], workspaceDigest: 'ws-1',
    actions: JSON.stringify({ tools: [{ name: 'write_file', success: true }, { name: 'bash', success: true }] }),
  })
  store.incrementReuse(id)
  store.promoteToOldGen(id)

  // Verify in old gen
  let rec = store.getById(id)
  assert(rec !== null, 'record should exist')
  assert(rec!.generation === 1, 'should be in old gen')

  // Trigger enforceRetention — experience is fresh (within TTL), should stay in old gen
  store.store(makeOutcome({ outcomeScore: 0.85 }), {
    taskPattern: 'bugfix', toolsUsed: ['grep'], workspaceDigest: 'ws-2',
    actions: JSON.stringify({ tools: [{ name: 'grep', success: true }] }),
  })

  rec = store.getById(id)
  assert(rec !== null, 'record should exist')
  assert(rec!.generation === 1, 'should stay in old gen (within TTL)')
  store.close()
})

// ---------------------------------------------------------------------------
// A3: Atomic facts
// ---------------------------------------------------------------------------

console.log('\n--- A3: Atomic Facts ---')

test('A3: upsertFact creates new fact', () => {
  const store = new ExperienceStore()
  const id = store.upsertFact('project:my-app', 'deploy-command', 'pnpm run deploy')
  assert(id.length > 0, 'should return an id')

  const facts = store.queryFacts('project:my-app')
  assert(facts.length === 1, 'should have 1 fact')
  assert(facts[0].subject === 'project:my-app', 'subject should match')
  assert(facts[0].predicate === 'deploy-command', 'predicate should match')
  assert(facts[0].object === 'pnpm run deploy', 'object should match')
  assert(facts[0].source === 'model-inferred', 'default source should be model-inferred')
  assert(!facts[0].evicted, 'should not be evicted')
  store.close()
})

test('A3: upsertFact updates existing fact (same subject+predicate)', () => {
  const store = new ExperienceStore()
  const id1 = store.upsertFact('project:my-app', 'build-tool', 'webpack')
  const id2 = store.upsertFact('project:my-app', 'build-tool', 'vite')
  assert(id1 === id2, 'should update same record, not create new')

  const facts = store.queryFacts('project:my-app')
  assert(facts.length === 1, 'should still have 1 fact')
  assert(facts[0].object === 'vite', 'object should be updated to vite')
  assert(facts[0].confidence > 0.5, 'confidence should be boosted')
  store.close()
})

test('A3: queryFacts by subject returns matching facts', () => {
  const store = new ExperienceStore()
  store.upsertFact('project:app-a', 'deploy-command', 'npm run deploy')
  store.upsertFact('project:app-a', 'test-command', 'npm test')
  store.upsertFact('project:app-b', 'deploy-command', 'pnpm deploy')

  const factsA = store.queryFacts('project:app-a')
  assert(factsA.length === 2, 'app-a should have 2 facts')

  const factsB = store.queryFacts('project:app-b')
  assert(factsB.length === 1, 'app-b should have 1 fact')
  store.close()
})

test('A3: queryFacts with searchText uses FTS5', () => {
  const store = new ExperienceStore()
  store.upsertFact('project:my-app', 'deploy-command', 'pnpm run deploy production')
  store.upsertFact('project:other', 'test-command', 'run jest tests')

  const results = store.queryFacts(undefined, 'deploy')
  assert(results.length >= 1, 'should find at least 1 fact matching "deploy"')
  assert(results.some((f) => f.object.includes('deploy')), 'should match the deploy fact')
  store.close()
})

test('A3: evictFact soft-deletes fact', () => {
  const store = new ExperienceStore()
  const id = store.upsertFact('project:my-app', 'build-tool', 'webpack')

  const evicted = store.evictFact(id)
  assert(evicted === true, 'evictFact should return true')

  const facts = store.queryFacts('project:my-app')
  assert(facts.length === 0, 'evicted fact should not appear in query')
  store.close()
})

// ---------------------------------------------------------------------------
// B1+B2: Source weights + Conflict detection
// ---------------------------------------------------------------------------

console.log('\n--- B1+B2: Source Weights + Conflict Detection ---')

test('B1: facts have source field', () => {
  const store = new ExperienceStore()
  store.upsertFact('project:app', 'deploy', 'npm deploy', 'user-confirmed')
  store.upsertFact('project:app', 'test', 'npm test', 'tool-derived')

  const facts = store.queryFacts('project:app')
  assert(facts.some((f) => f.source === 'user-confirmed'), 'should have user-confirmed source')
  assert(facts.some((f) => f.source === 'tool-derived'), 'should have tool-derived source')
  store.close()
})

test('B2: detectFactConflicts finds same subject+predicate with different objects', () => {
  const store = new ExperienceStore()
  // Two facts with same subject+predicate but different objects (direct insert to avoid upsert merging)
  store.db.prepare(`
    INSERT INTO atomic_facts (id, subject, predicate, object, source, confidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('id1', 'project:app', 'build-tool', 'webpack', 'model-inferred', 0.5, Date.now())
  store.db.prepare(`
    INSERT INTO atomic_facts (id, subject, predicate, object, source, confidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('id2', 'project:app', 'build-tool', 'vite', 'user-confirmed', 0.8, Date.now())

  const conflicts = store.detectFactConflicts()
  assert(conflicts.length === 1, 'should detect 1 conflict group')
  assert(conflicts[0].subject === 'project:app', 'conflict subject should match')
  assert(conflicts[0].predicate === 'build-tool', 'conflict predicate should match')
  assert(conflicts[0].conflicts.length === 2, 'should have 2 conflicting facts')
  store.close()
})

test('B2: conflict resolution — user-confirmed ranks higher than model-inferred', () => {
  const store = new ExperienceStore()
  store.db.prepare(`
    INSERT INTO atomic_facts (id, subject, predicate, object, source, confidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('id1', 'project:app', 'build-tool', 'webpack', 'model-inferred', 0.5, Date.now())
  store.db.prepare(`
    INSERT INTO atomic_facts (id, subject, predicate, object, source, confidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('id2', 'project:app', 'build-tool', 'vite', 'user-confirmed', 0.8, Date.now())

  const conflicts = store.detectFactConflicts()
  const sorted = conflicts[0].conflicts
  // user-confirmed (weight 4) should rank higher than model-inferred (weight 2)
  assert(sorted[0].source === 'user-confirmed', 'user-confirmed should rank first')
  assert(sorted[0].object === 'vite', 'the user-confirmed fact (vite) should be first')
  store.close()
})

test('B2: evictFact resolves conflict — old fact evicted, new remains', () => {
  const store = new ExperienceStore()
  const oldId = 'old-fact-id'
  const newId = 'new-fact-id'
  store.db.prepare(`
    INSERT INTO atomic_facts (id, subject, predicate, object, source, confidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(oldId, 'project:app', 'build-tool', 'webpack', 'model-inferred', 0.5, Date.now() - 1000)
  store.db.prepare(`
    INSERT INTO atomic_facts (id, subject, predicate, object, source, confidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(newId, 'project:app', 'build-tool', 'vite', 'user-confirmed', 0.9, Date.now())

  // Evict the old fact
  store.evictFact(oldId)

  const conflicts = store.detectFactConflicts()
  assert(conflicts.length === 0, 'no conflicts after eviction')

  const facts = store.queryFacts('project:app')
  assert(facts.length === 1, 'should have 1 non-evicted fact')
  assert(facts[0].object === 'vite', 'remaining fact should be vite')
  store.close()
})

console.log(`\n${passed} passed, ${failed} failed\n`)
