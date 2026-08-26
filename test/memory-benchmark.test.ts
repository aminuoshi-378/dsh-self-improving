/**
 * Memory Benchmark Tests — 基于 AlekseiMarchenko/agent-memory-benchmark 模式
 *
 * 参考 AMB 的 8 个测试类别 + Layer 2 多步场景，直接测试 ExperienceStore 的
 * store/query/deleteById/markMerged 接口，验证以下核心功能：
 *
 *   1. Conflict Resolution — 经验去重（相同 context_hash 只保留最新）
 *   2. Cross-Session — 跨会话经验召回
 *   3. Selective Forgetting — merged 标记后 query 跳过
 *   4. Difficulty Priority — 高难度经验优先排序
 *   5. Multi-step 连续任务 — 去重 + 跨会话 + 难度优先联动
 *
 * AMB 仓库: https://github.com/AlekseiMarchenko/agent-memory-benchmark
 */

import { ExperienceStore } from '../src/store/experience-store.js'
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

/** 构造一个 TurnOutcome */
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

console.log('\n=== Memory Benchmark Tests (AMB pattern) ===')

// ---------------------------------------------------------------------------
// 测试组 1: Conflict Resolution — 经验去重
// 参考 AMB conflict-resolution.ts cr-01 ~ cr-07
// ---------------------------------------------------------------------------

console.log('\n--- 1. Conflict Resolution (经验去重) ---')

test('1.1 相同 toolsUsed + taskPattern 去重 — 保留最新', () => {
  const store = new ExperienceStore()
  const tools = ['grep', 'edit_file']
  const ws = 'ws-api'

  // 存入第一条（评分 0.6，时间较早）
  const id1 = store.store(
    makeOutcome({ outcomeScore: 0.6, timestamp: Date.now() - 10000 }),
    { taskPattern: 'bugfix', toolsUsed: tools, workspaceDigest: ws, actions: 'old fix' },
  )
  // 存入第二条（评分 0.9，时间较新）— context_hash 相同
  const id2 = store.store(
    makeOutcome({ outcomeScore: 0.9, timestamp: Date.now() }),
    { taskPattern: 'bugfix', toolsUsed: tools, workspaceDigest: ws, actions: 'new fix' },
  )

  assert(store.count() === 2, '应有 2 条记录')

  // query 不带 toolsUsed 过滤（触发全量排序路径），去重后应只有 1 条
  const results = store.query({ limit: 10, minScore: 0.0 })
  const sameHash = results.filter((r) =>
    r.contextHash === store.computeContextHash('bugfix', tools, ws),
  )
  assert(sameHash.length === 1, `去重后同 context_hash 应只有 1 条，实际 ${sameHash.length}`)
  assert(sameHash[0].id === id2, '应保留最新的 id2')
  assert(sameHash[0].outcomeScore === 0.9, '保留的应是评分 0.9 的')

  store.close()
})

test('1.2 不同 toolsUsed 不去重 — 各保留', () => {
  const store = new ExperienceStore()

  store.store(
    makeOutcome({ outcomeScore: 0.7 }),
    { taskPattern: 'bugfix', toolsUsed: ['grep', 'edit_file'], workspaceDigest: 'ws-a', actions: 'fix A' },
  )
  store.store(
    makeOutcome({ outcomeScore: 0.8 }),
    { taskPattern: 'bugfix', toolsUsed: ['grep', 'read_file'], workspaceDigest: 'ws-a', actions: 'fix B' },
  )

  const results = store.query({ limit: 10, minScore: 0.0 })
  assert(results.length === 2, `不同 context_hash 不应去重，应有 2 条，实际 ${results.length}`)

  store.close()
})

test('1.3 连续 3 条同 context_hash — 保留最后一条', () => {
  const store = new ExperienceStore()
  const ctx = { taskPattern: 'bugfix', toolsUsed: ['grep', 'edit_file'], workspaceDigest: 'ws-x', actions: '' }

  const ids: string[] = []
  for (let i = 0; i < 3; i++) {
    ids.push(store.store(
      makeOutcome({ outcomeScore: 0.5 + i * 0.15, timestamp: Date.now() + i * 1000 }),
      { ...ctx, actions: `iteration-${i}` },
    ))
  }

  const results = store.query({ limit: 10, minScore: 0.0 })
  const sameHash = results.filter((r) => r.actions.startsWith('iteration-'))
  assert(sameHash.length === 1, `3 条同 context_hash 去重后应剩 1 条，实际 ${sameHash.length}`)
  assert(sameHash[0].actions === 'iteration-2', '应保留最后一条')

  store.close()
})

// ---------------------------------------------------------------------------
// 测试组 2: Cross-Session — 跨会话经验召回
// 参考 AMB cross-session.ts cs-01 ~ cs-07
// ---------------------------------------------------------------------------

console.log('\n--- 2. Cross-Session (跨会话经验召回) ---')

test('2.1 session-A 的经验能被 session-B 的 query 召回', () => {
  const store = new ExperienceStore()

  // session-A 完成任务存入经验
  store.store(
    makeOutcome({ sessionId: 'session-A', outcomeScore: 0.85, difficulty: 'high' }),
    { taskPattern: 'bugfix', toolsUsed: ['grep', 'read_file', 'edit_file'], workspaceDigest: 'ws-shared', actions: 'fixed auth bug' },
  )
  // session-B 存入无关经验（干扰项）
  store.store(
    makeOutcome({ sessionId: 'session-B', outcomeScore: 0.5, difficulty: 'low' }),
    { taskPattern: 'feature', toolsUsed: ['write_file'], workspaceDigest: 'ws-other', actions: 'added logging' },
  )

  // session-B 做类似 bugfix，query 召回
  const results = store.query({
    taskPattern: 'bugfix',
    toolsUsed: ['grep'],
    workspaceDigest: 'ws-shared',
    limit: 5,
  })

  assert(results.length >= 1, `应召回至少 1 条，实际 ${results.length}`)
  assert(results[0].sessionId === 'session-A', '应召回 session-A 的经验')
  assert(results[0].outcomeScore === 0.85, '评分应为 0.85')
  assert(results[0].actions === 'fixed auth bug', 'actions 应匹配')

  store.close()
})

test('2.2 多条跨会话经验 — 按相似度排序', () => {
  const store = new ExperienceStore()

  // 3 个不同 session 的 bugfix 经验
  store.store(
    makeOutcome({ sessionId: 's1', outcomeScore: 0.7 }),
    { taskPattern: 'bugfix', toolsUsed: ['grep', 'edit_file'], workspaceDigest: 'ws-api', actions: 's1 fix' },
  )
  store.store(
    makeOutcome({ sessionId: 's2', outcomeScore: 0.9 }),
    { taskPattern: 'bugfix', toolsUsed: ['grep', 'read_file', 'edit_file'], workspaceDigest: 'ws-api', actions: 's2 fix' },
  )
  store.store(
    makeOutcome({ sessionId: 's3', outcomeScore: 0.6 }),
    { taskPattern: 'bugfix', toolsUsed: ['grep', 'read_file', 'edit_file', 'run_tests'], workspaceDigest: 'ws-api', actions: 's3 fix' },
  )

  // query 用与 s2 最相似的 tools
  const results = store.query({
    taskPattern: 'bugfix',
    toolsUsed: ['grep', 'read_file', 'edit_file'],
    workspaceDigest: 'ws-api',
    limit: 3,
  })

  assert(results.length === 3, `应召回 3 条，实际 ${results.length}`)
  // s2 的工具完全匹配，评分最高（0.9），应排第一
  assert(results[0].sessionId === 's2', `第一条应为 s2（工具完全匹配+评分最高），实际 ${results[0].sessionId}`)

  store.close()
})

test('2.3 不同 taskPattern 不互相干扰', () => {
  const store = new ExperienceStore()

  store.store(
    makeOutcome({ outcomeScore: 0.9 }),
    { taskPattern: 'bugfix', toolsUsed: ['grep', 'edit_file'], workspaceDigest: 'ws', actions: 'bugfix' },
  )
  store.store(
    makeOutcome({ outcomeScore: 0.5 }),
    { taskPattern: 'feature', toolsUsed: ['grep', 'edit_file'], workspaceDigest: 'ws', actions: 'feature' },
  )

  const bugfixResults = store.query({ taskPattern: 'bugfix', limit: 10 })
  const allResults = store.query({ limit: 10 })

  assert(bugfixResults.every((r) => r.taskPattern === 'bugfix' || r.taskPattern === null),
    'taskPattern=bugfix 的 query 不应返回 feature 经验')
  assert(allResults.length === 2, '不带 taskPattern 的 query 应返回全部 2 条')

  store.close()
})

// ---------------------------------------------------------------------------
// 测试组 3: Selective Forgetting — merged 跳过 + delete
// 参考 AMB selective-forgetting.ts
// ---------------------------------------------------------------------------

console.log('\n--- 3. Selective Forgetting (merged 跳过 + delete) ---')

test('3.1 merged=true 的经验 query 时不返回', () => {
  const store = new ExperienceStore()

  const id1 = store.store(
    makeOutcome({ outcomeScore: 0.8 }),
    { taskPattern: 'bugfix', toolsUsed: ['grep'], workspaceDigest: 'ws', actions: 'kept' },
  )
  store.store(
    makeOutcome({ outcomeScore: 0.7 }),
    { taskPattern: 'bugfix', toolsUsed: ['read_file'], workspaceDigest: 'ws', actions: 'merged' },
  )

  // 标记第二条为 merged
  store.markMerged(id1)

  const results = store.query({ limit: 10, minScore: 0.0 })
  assert(results.length === 1, `merged 后 query 应只返回 1 条，实际 ${results.length}`)
  assert(results[0].actions !== 'kept', '被 merged 的记录不应出现')

  store.close()
})

test('3.2 deleteById 删除后不再返回', () => {
  const store = new ExperienceStore()

  const id = store.store(
    makeOutcome({ outcomeScore: 0.9 }),
    { taskPattern: 'bugfix', toolsUsed: ['grep'], workspaceDigest: 'ws', actions: 'to delete' },
  )

  assert(store.count() === 1, '应有 1 条')
  const deleted = store.deleteById(id)
  assert(deleted === true, 'deleteById 应返回 true')
  assert(store.count() === 0, '删除后应为 0 条')

  const results = store.query({ limit: 10 })
  assert(results.length === 0, '删除后 query 应返回 0 条')

  store.close()
})

test('3.3 deleteById 不存在的 id 返回 false', () => {
  const store = new ExperienceStore()
  const deleted = store.deleteById('nonexistent-id')
  assert(deleted === false, '删除不存在的 id 应返回 false')
  store.close()
})

// ---------------------------------------------------------------------------
// 测试组 4: Difficulty Priority — 高难度优先排序
// 参考 AMB Layer2 preference-application + 本项目 P0 难度分级
// ---------------------------------------------------------------------------

console.log('\n--- 4. Difficulty Priority (高难度优先) ---')

test('4.1 无 toolsUsed 过滤时 — high > medium > low', () => {
  const store = new ExperienceStore()

  // 不同 context_hash，避免去重
  store.store(
    makeOutcome({ outcomeScore: 0.8, difficulty: 'low' }),
    { taskPattern: 'bugfix', toolsUsed: ['grep'], workspaceDigest: 'ws-low', actions: 'low' },
  )
  store.store(
    makeOutcome({ outcomeScore: 0.8, difficulty: 'high' }),
    { taskPattern: 'bugfix', toolsUsed: ['grep', 'edit_file'], workspaceDigest: 'ws-high', actions: 'high' },
  )
  store.store(
    makeOutcome({ outcomeScore: 0.8, difficulty: 'medium' }),
    { taskPattern: 'bugfix', toolsUsed: ['grep', 'read_file'], workspaceDigest: 'ws-med', actions: 'medium' },
  )

  const results = store.query({ limit: 10, minScore: 0.0 })

  assert(results.length === 3, `应返回 3 条，实际 ${results.length}`)
  assert(results[0].difficulty === 'high', `第一条应为 high，实际 ${results[0].difficulty}`)
  assert(results[1].difficulty === 'medium', `第二条应为 medium，实际 ${results[1].difficulty}`)
  assert(results[2].difficulty === 'low', `第三条应为 low，实际 ${results[2].difficulty}`)

  store.close()
})

test('4.2 同难度同 score — 时间近的优先', () => {
  const store = new ExperienceStore()

  store.store(
    makeOutcome({ outcomeScore: 0.85, difficulty: 'high', timestamp: Date.now() - 50000 }),
    { taskPattern: 'bugfix', toolsUsed: ['grep'], workspaceDigest: 'ws-old', actions: 'old' },
  )
  store.store(
    makeOutcome({ outcomeScore: 0.85, difficulty: 'high', timestamp: Date.now() }),
    { taskPattern: 'bugfix', toolsUsed: ['read_file'], workspaceDigest: 'ws-new', actions: 'new' },
  )

  const results = store.query({ limit: 10, minScore: 0.0 })

  assert(results.length === 2, `应返回 2 条，实际 ${results.length}`)
  assert(results[0].difficulty === 'high', '第一条应为 high')
  assert(results[1].difficulty === 'high', '第二条也应为 high')
  // 同难度同分数时，SQL ORDER BY created_at DESC 保证时间近的在前
  assert(results[0].actions === 'new', `时间近的应排前面，实际第一条 ${results[0].actions}`)

  store.close()
})

test('4.3 minScore 过滤低分经验', () => {
  const store = new ExperienceStore()

  store.store(
    makeOutcome({ outcomeScore: 0.3 }),
    { taskPattern: 'bugfix', toolsUsed: ['grep'], workspaceDigest: 'ws-a', actions: 'low score' },
  )
  store.store(
    makeOutcome({ outcomeScore: 0.9 }),
    { taskPattern: 'bugfix', toolsUsed: ['edit_file'], workspaceDigest: 'ws-b', actions: 'high score' },
  )

  const results = store.query({ limit: 10, minScore: 0.5 })
  assert(results.length === 1, `minScore=0.5 应只返回 1 条，实际 ${results.length}`)
  assert(results[0].outcomeScore === 0.9, '保留的应是 0.9 分的')

  store.close()
})

// ---------------------------------------------------------------------------
// 测试组 5: Multi-step 连续任务
// 参考 AMB Layer2 context-continuity.json + conflict-resolution-multi.json
// 模拟 agent 连续完成 5 个有依赖关系的任务，验证去重 + 跨会话 + 难度优先联动
// ---------------------------------------------------------------------------

console.log('\n--- 5. Multi-step 连续任务 (联动测试) ---')

test('5.1 连续 5 个任务 — 去重 + 跨会话 + 难度优先联动', () => {
  const store = new ExperienceStore()

  // Task 1: 搭建项目框架 (session-1, low 难度, 评分 0.7)
  store.store(
    makeOutcome({
      sessionId: 'session-1', turnId: 'turn-1',
      outcomeScore: 0.7, difficulty: 'low',
      toolCallCount: 2, stepEfficiency: 0.95,
    }),
    {
      taskPattern: 'feature',
      toolsUsed: ['write_file', 'write_file'],
      workspaceDigest: 'ws-project',
      actions: 'Set up project scaffold with Express framework',
    },
  )

  // Task 2: 添加认证 (session-1, medium 难度, 评分 0.85)
  store.store(
    makeOutcome({
      sessionId: 'session-1', turnId: 'turn-2',
      outcomeScore: 0.85, difficulty: 'medium',
      toolCallCount: 3, stepEfficiency: 0.85,
    }),
    {
      taskPattern: 'feature',
      toolsUsed: ['read_file', 'grep', 'write_file'],
      workspaceDigest: 'ws-project',
      actions: 'Added authentication using JWT tokens',
    },
  )

  // Task 3: 修认证 bug (session-2, high 难度, 评分 0.9)
  // 工具序列与 Task 2 部分重叠 → context_hash 不同（tools 不同），不会去重
  store.store(
    makeOutcome({
      sessionId: 'session-2', turnId: 'turn-3',
      outcomeScore: 0.9, difficulty: 'high',
      toolCallCount: 3, stepEfficiency: 0.85,
    }),
    {
      taskPattern: 'bugfix',
      toolsUsed: ['grep', 'read_file', 'edit_file'],
      workspaceDigest: 'ws-project',
      actions: 'Fixed JWT token expiry logic in auth middleware',
    },
  )

  // Task 4: 数据库迁移 (session-2, medium 难度, 评分 0.8)
  store.store(
    makeOutcome({
      sessionId: 'session-2', turnId: 'turn-4',
      outcomeScore: 0.8, difficulty: 'medium',
      toolCallCount: 3, stepEfficiency: 0.85,
    }),
    {
      taskPattern: 'refactoring',
      toolsUsed: ['grep', 'read_file', 'write_file'],
      workspaceDigest: 'ws-project',
      actions: 'Migrated database from SQLite to PostgreSQL',
    },
  )

  // Task 5: 再修类似认证 bug (session-3, high 难度)
  // 工具序列与 Task 3 完全相同 → context_hash 相同 → 去重保留最新
  store.store(
    makeOutcome({
      sessionId: 'session-3', turnId: 'turn-5',
      outcomeScore: 0.95, difficulty: 'high',
      toolCallCount: 3, stepEfficiency: 0.85,
    }),
    {
      taskPattern: 'bugfix',
      toolsUsed: ['grep', 'read_file', 'edit_file'],
      workspaceDigest: 'ws-project',
      actions: 'Fixed another JWT expiry edge case',
    },
  )

  assert(store.count() === 5, `应存入 5 条，实际 ${store.count()}`)

  // 验证 1: Task 3 和 Task 5 去重 → query 返回 4 条
  const allResults = store.query({ limit: 10, minScore: 0.0 })
  assert(allResults.length === 4, `5 条去重后应返回 4 条，实际 ${allResults.length}`)

  // 验证 2: Task 5 覆盖了 Task 3（相同 context_hash，保留最新）
  // Task 3 和 Task 5 的 context_hash = bugfix|edit_file,grep,read_file|ws-project
  const authBugfixHash = 'bugfix|edit_file,grep,read_file|ws-project'
  const authFixes = allResults.filter((r) => r.contextHash === authBugfixHash)
  assert(authFixes.length === 1, `同 context_hash 去重后应只有 1 条，实际 ${authFixes.length}`)
  assert(authFixes[0].actions.includes('another JWT'), '应保留 Task 5 的（最新）')

  // 验证 3: 无 toolsUsed 过滤时，high 难度排前面
  // 去重后 4 条：Task5(high,0.95), Task2(medium,0.85), Task4(medium,0.8), Task1(low,0.7)
  assert(allResults[0].difficulty === 'high', `排序后第一条应为 high，实际 ${allResults[0].difficulty}`)
  assert(allResults[0].outcomeScore === 0.95, `第一条应为 Task5 (0.95)，实际 ${allResults[0].outcomeScore}`)
  assert(allResults[3].difficulty === 'low', `最后一条应为 low，实际 ${allResults[3].difficulty}`)

  // 验证 4: session-3 做认证 bugfix 时，能召回 session-2 的经验（跨会话）
  // 但因为去重，Task 5 覆盖了 Task 3，所以返回的是 Task 5 自己（session-3）
  // 改为验证：session-2 的数据库迁移经验能被召回
  const dbResults = store.query({
    taskPattern: 'refactoring',
    toolsUsed: ['grep', 'read_file'],
    workspaceDigest: 'ws-project',
    limit: 5,
  })
  assert(dbResults.length >= 1, `refactoring query 应返回至少 1 条，实际 ${dbResults.length}`)
  assert(dbResults[0].actions.includes('Migrated database'), '应召回数据库迁移经验')

  // 验证 5: minScore 过滤能正确排除低分经验
  const highScoreResults = store.query({ limit: 10, minScore: 0.85 })
  assert(highScoreResults.every((r) => r.outcomeScore >= 0.85), '所有返回的评分应 >= 0.85')
  assert(!highScoreResults.some((r) => r.actions.includes('scaffold')), 'Task 1 (0.7分) 不应出现')

  store.close()
})

test('5.2 连续冲突链 — 同一事实被 3 次更新，保留最新', () => {
  // 参考 AMB Layer2 conflict-resolution-multi.json
  const store = new ExperienceStore()
  const tools = ['grep', 'edit_file']
  const ws = 'ws-config'

  // 模拟 agent 3 次修改同一配置（工具序列相同 → context_hash 相同）
  const timestamps = [Date.now() - 30000, Date.now() - 20000, Date.now()]
  const values = ['timeout=30s', 'timeout=60s', 'timeout=120s']

  for (let i = 0; i < 3; i++) {
    store.store(
      makeOutcome({
        outcomeScore: 0.6 + i * 0.1,
        timestamp: timestamps[i],
      }),
      {
        taskPattern: 'refactoring',
        toolsUsed: tools,
        workspaceDigest: ws,
        actions: `Config change: ${values[i]}`,
      },
    )
  }

  const results = store.query({ limit: 10, minScore: 0.0 })
  const configChanges = results.filter((r) => r.actions.includes('timeout'))
  assert(configChanges.length === 1, `3 条同 context_hash 去重后应剩 1 条，实际 ${configChanges.length}`)
  assert(configChanges[0].actions.includes('timeout=120s'), '应保留最新的 timeout=120s')

  store.close()
})

test('5.3 混合场景 — 去重 + merged + minScore 联动', () => {
  const store = new ExperienceStore()

  // 4 条经验：
  // A: bugfix, [grep, edit_file], score=0.9, high
  // B: bugfix, [grep, edit_file], score=0.6, medium (同 A 的 context_hash → 去重保留 A)
  // C: bugfix, [grep, read_file], score=0.85, high, merged=true (应被跳过)
  // D: feature, [write_file], score=0.7, low

  const idA = store.store(
    makeOutcome({ outcomeScore: 0.9, difficulty: 'high', timestamp: Date.now() }),
    { taskPattern: 'bugfix', toolsUsed: ['grep', 'edit_file'], workspaceDigest: 'ws-1', actions: 'A' },
  )
  store.store(
    makeOutcome({ outcomeScore: 0.6, difficulty: 'medium', timestamp: Date.now() - 10000 }),
    { taskPattern: 'bugfix', toolsUsed: ['grep', 'edit_file'], workspaceDigest: 'ws-1', actions: 'B' },
  )
  const idC = store.store(
    makeOutcome({ outcomeScore: 0.85, difficulty: 'high', timestamp: Date.now() }),
    { taskPattern: 'bugfix', toolsUsed: ['grep', 'read_file'], workspaceDigest: 'ws-1', actions: 'C' },
  )
  store.store(
    makeOutcome({ outcomeScore: 0.7, difficulty: 'low', timestamp: Date.now() }),
    { taskPattern: 'feature', toolsUsed: ['write_file'], workspaceDigest: 'ws-2', actions: 'D' },
  )

  assert(store.count() === 4, `应存入 4 条，实际 ${store.count()}`)

  // 标记 C 为 merged
  store.markMerged(idC)

  // query: 不带过滤，minScore=0
  const results = store.query({ limit: 10, minScore: 0.0 })

  // 预期: A (去重保留，high, 0.9) + D (feature, low, 0.7) = 2 条
  // B 被 A 去重，C 被 merged 跳过
  assert(results.length === 2, `去重+merged 后应返回 2 条，实际 ${results.length}`)
  assert(results.some((r) => r.actions === 'A'), 'A 应存在')
  assert(results.some((r) => r.actions === 'D'), 'D 应存在')
  assert(!results.some((r) => r.actions === 'B'), 'B 应被 A 去重')
  assert(!results.some((r) => r.actions === 'C'), 'C 应被 merged 跳过')

  // 验证 A 排在 D 前面（high > low）
  assert(results[0].actions === 'A', `high 难度应排前面，实际 ${results[0].actions}`)

  store.close()
})

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n--- Memory Benchmark Summary: ${passed} passed, ${failed} failed ---`)
if (failed > 0) {
  process.exit(1)
}
