/**
 * Correction signal tests — 重构计划「以用户纠正为黄金信号」。
 *
 * 覆盖检测层四分类 + 节点定位、interrupt 识别、评分扣分、
 * store 持久化 CRUD，以及 lesson 提炼接入纠正上下文。
 */

import {
  classifyCorrectionText,
  correctionTypeSeverity,
  computeTargetSeqHash,
  detectInterrupt,
  detectCorrectionEvents,
  toCorrectionSignal,
  extractCorrectionIntentRuleBased,
  formatCorrectionAdvisory,
  extractCorrectionCandidates,
} from '../src/correction-detector.js'
import { correctionPenalty, computeOutcomeScore, type CorrectionEvent } from '../src/types/index.js'
import { ExperienceStore } from '../src/store/experience-store.js'
import { generateStructuredReflection } from '../src/reflection.js'
import { extractCorrectionIntent, classifyCorrectionCandidatesWithLLM } from '../src/llm-bridge.js'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`)
}

let passed = 0
let failed = 0

const registeredTests: { name: string; fn: () => void | Promise<void> }[] = []

function test(name: string, fn: () => void | Promise<void>): void {
  registeredTests.push({ name, fn })
}

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

function makeTurn(turn: number, userTexts: string[], aborted = false): any[] {
  const events: any[] = [{ type: 'turn/start', seq: turn * 100, data: { turn } }]
  userTexts.forEach((text, i) => {
    events.push({
      type: 'user/message',
      seq: turn * 100 + 1 + i,
      data: { id: `msg-${turn}-${i}`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] },
    })
  })
  events.push({ type: 'turn/end', seq: turn * 100 + 99, data: { turn, reason: { kind: aborted ? 'aborted' : 'completed' } } })
  return events
}

// ---------------------------------------------------------------------------

console.log('\n--- Correction: classifyCorrectionText ---')

test('correction: 相悖/替代做法 → correction', () => {
  assert(classifyCorrectionText('其实我的意思是先做 A 再做 B') === 'correction', '意思纠正')
  assert(classifyCorrectionText('你理解错了，不是那个') === 'correction', '理解错了')
  assert(classifyCorrectionText('actually i meant the other one') === 'correction', 'english correction')
})

test('correction: 撤销/回退 → revert', () => {
  assert(classifyCorrectionText('撤销刚才那个改动') === 'revert', '撤销')
  assert(classifyCorrectionText('回退到上一版') === 'revert', '回退')
  assert(classifyCorrectionText('undo that change') === 'revert', 'undo')
})

test('correction: 重做/换方式 → redo', () => {
  assert(classifyCorrectionText('重新来一遍') === 'redo', '重新')
  assert(classifyCorrectionText('换个方式做') === 'redo', '换个方式')
  assert(classifyCorrectionText('try again differently') === 'redo', 'english redo')
})

test('correction: 普通补充信息不算纠正', () => {
  assert(classifyCorrectionText('再加一个按钮') === null, '追加需求不算纠正')
  assert(classifyCorrectionText('好的继续') === null, '正常推进不算纠正')
})

console.log('\n--- Correction: severity mapping ---')

test('correctionTypeSeverity: revert/correction = high, redo/interrupt = medium', () => {
  assert(correctionTypeSeverity('revert') === 'high', 'revert → high')
  assert(correctionTypeSeverity('correction') === 'high', 'correction → high')
  assert(correctionTypeSeverity('redo') === 'medium', 'redo → medium')
  assert(correctionTypeSeverity('interrupt') === 'medium', 'interrupt → medium')
})

test('computeTargetSeqHash: 稳定指纹，空序列为 null', () => {
  const h1 = computeTargetSeqHash([{ name: 'git_commit', success: true }])
  const h2 = computeTargetSeqHash([{ name: 'git_commit', success: true }])
  assert(h1 === h2 && h1 !== null, '同序列同 hash')
  assert(computeTargetSeqHash([]) === null, '空序列 → null')
})

console.log('\n--- Correction: detectCorrectionEvents 四分类 + 节点定位 ---')

test('第二条用户消息命中关键词 → 生成事件并定位到工具', () => {
  const events = makeTurn(1, ['list users', '撤销，用别的方式处理'])
  const tools = [{ name: 'list_users', success: true }]
  const result = detectCorrectionEvents(events, 1, tools, 'session-1')
  assert(result.length === 1, '检测到 1 条纠正')
  assert(result[0].type === 'revert', '类型 revert')
  assert(result[0].severity === 'high', 'severity high')
  assert(result[0].targetTool === 'list_users', '定位到工具')
  assert(result[0].targetSeqHash !== null, '内容指纹非空')
})

test('第一条用户消息（任务描述）不算纠正', () => {
  const events = makeTurn(1, ['撤销这个任务']) // 仅一条
  const result = detectCorrectionEvents(events, 1, [], 'session-1')
  assert(result.length === 0, '单条任务消息不判纠正')
})

console.log('\n--- Correction: detectInterrupt 打断-重输 ---')

test('主动中止 + 重输 → interrupt 事件', () => {
  const events = [
    { type: 'turn/start', seq: 100, data: { turn: 1 } },
    { type: 'user/message', seq: 101, data: { id: 'a', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'deploy the app to staging' }] } },
    { type: 'turn/end', seq: 199, data: { turn: 1, reason: { kind: 'aborted' } } },
    { type: 'user/message', seq: 200, data: { id: 'b', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'deploy the app to staging instead' }] } },
  ]
  const interrupts = detectInterrupt(events, 1, [], 'session-1')
  assert(interrupts !== null, '检测到 interrupt')
  assert(interrupts!.type === 'interrupt', '类型 interrupt')
  assert(interrupts!.severity === 'medium', 'severity medium')
})

test('未被主动中止 → 不产生 interrupt', () => {
  const events = makeTurn(1, ['deploy the app'])
  assert(detectInterrupt(events, 1, [], 'session-1') === null, 'completed 不是 interrupt')
})

console.log('\n--- Correction: toCorrectionSignal 汇总 ---')

test('空事件 → count=0 severity=null；多事件取最高 severity', () => {
  assert(toCorrectionSignal([]).count === 0, '空信号 count 0')
  const events: CorrectionEvent[] = [
    { id: '1', turnId: 't1', sessionId: 's', type: 'redo', seq: 1, targetTool: null, targetSeqHash: null, userText: 'x', intent: null, severity: 'medium', createdAt: 0 },
  ]
  assert(toCorrectionSignal(events).severity === 'medium', 'single medium')
  events.push({ id: '2', turnId: 't1', sessionId: 's', type: 'revert', seq: 2, targetTool: null, targetSeqHash: null, userText: 'y', intent: null, severity: 'high', createdAt: 0 })
  assert(toCorrectionSignal(events).count === 2, 'count 聚合')
  assert(toCorrectionSignal(events).severity === 'high', '最高 severity 胜出')
})

console.log('\n--- Correction: scoring penalty（纠正扣分） ---')

const BASE_SCORING = {
  goalProgress: 'stalled' as const,
  toolSuccessRate: 0.8,
  stepEfficiency: 0.7,
  guardTriggerCount: 0,
  userFeedback: 'none' as const,
}

test('无纠正 → 不扣分；revert 纠正 → 扣分', () => {
  const baseScore = computeOutcomeScore(BASE_SCORING)
  const withCorrection = computeOutcomeScore({
    ...BASE_SCORING,
    correctionSignal: { count: 1, severity: 'high' },
  })
  assert(withCorrection < baseScore, '纠正后分数下降')
})

test('correctionPenalty: 无纠正=0，severity 越高扣分越大', () => {
  assert(correctionPenalty(undefined) === 0, 'undefined → 0')
  assert(correctionPenalty({ count: 0, severity: null }) === 0, '空信号 → 0')
  const low = correctionPenalty({ count: 1, severity: 'low' })
  const high = correctionPenalty({ count: 1, severity: 'high' })
  assert(high > low && high > 0, 'high 扣分 > low')
})

console.log('\n--- Correction: store CRUD（持久化） ---')

test('storeCorrectionEvents + queryCorrectionEventsByTurn 往返一致', () => {
  const store = new ExperienceStore(':memory:')
  try {
    const ev: CorrectionEvent = {
      id: 'corr-1-2', turnId: 'turn-1', sessionId: 'sess', type: 'correction',
      seq: 2, targetTool: 'edit_file', targetSeqHash: 'abc', userText: 'should be X',
      intent: null, severity: 'high', createdAt: Date.now(),
    }
    store.storeCorrectionEvents('sess', 'turn-1', [ev])
    const loaded = store.queryCorrectionEventsByTurn('turn-1')
    assert(loaded.length === 1, '插入了 1 条')
    assert(loaded[0].type === 'correction' && loaded[0].severity === 'high', '字段往返一致')
    assert(loaded[0].targetSeqHash === 'abc', 'targetSeqHash 一致')
  } finally {
    store.close()
  }
})

test('queryCorrectionEvents 按时间倒序返回最新纠正', () => {
  const store = new ExperienceStore(':memory:')
  try {
    store.storeCorrectionEvents('s1', 'turn-1', [{
      id: 'a', turnId: 'turn-1', sessionId: 's1', type: 'redo', seq: 2,
      targetTool: null, targetSeqHash: null, userText: 'old', intent: null, severity: 'medium', createdAt: 100,
    }])
    store.storeCorrectionEvents('s1', 'turn-2', [{
      id: 'b', turnId: 'turn-2', sessionId: 's1', type: 'revert', seq: 2,
      targetTool: null, targetSeqHash: null, userText: 'new', intent: null, severity: 'high', createdAt: 200,
    }])
    const recent = store.queryCorrectionEvents(5)
    assert(recent.length === 2, '2 条纠正')
    assert(recent[0].userText === 'new', '最新在前')
  } finally {
    store.close()
  }
})

console.log('\n--- Correction: lesson 提炼接入纠正上下文 ---')

test('generateStructuredReflection 带纠正 → reusableLesson 强调避让', () => {
  const refl = generateStructuredReflection({
    actions: JSON.stringify({ tools: [{ name: 'git_commit', success: true }] }),
    outcomeScore: 0.4,
    userFeedback: 'none',
    toolsUsed: ['git_commit'],
    difficulty: 'medium',
    correction: '[revert] 撤销，不要直接提交到 main',
  } as any)
  assert(refl.reusableLesson.toLowerCase().includes('rejected'), 'lesson 标明用户拒绝')
  assert(refl.whatFailed.includes('撤销'), 'whatFailed 带纠正上下文')
})

// ---------------------------------------------------------------------------

console.log('\n--- Correction: Δ7.1 intent 语义提炼 ---')

test('extractCorrectionIntentRuleBased: 类型提示 + 用户原话', () => {
  const ev: CorrectionEvent = {
    id: 'c', turnId: 't', sessionId: 's', type: 'revert', seq: 1,
    targetTool: null, targetSeqHash: null, userText: '撤销，不要生成代码', intent: null, severity: 'high', createdAt: 0,
  }
  const intent = extractCorrectionIntentRuleBased(ev)
  assert(intent.includes('撤销'), '含类型提示')
  assert(intent.includes('不要生成代码'), '含用户原话')
})

test('extractCorrectionIntentRuleBased: 空文本返回空串', () => {
  const ev: CorrectionEvent = {
    id: 'c', turnId: 't', sessionId: 's', type: 'interrupt', seq: 1,
    targetTool: null, targetSeqHash: null, userText: '  ', intent: null, severity: 'medium', createdAt: 0,
  }
  assert(extractCorrectionIntentRuleBased(ev) === '', '空文本 → 空串')
})

test('extractCorrectionIntent: LLM 不可用时返回 null（触发规则回退）', async () => {
  const ctx = { get: () => undefined } // 无 llm → null
  const created = await extractCorrectionIntent(ctx, '撤销刚才的改动', undefined)
  assert(created === null, '无 LLM 返回 null')
})

test('store.updateCorrectionIntent: 断言更新 intent 后可回读', () => {
  const store = new ExperienceStore(':memory:')
  try {
    store.storeCorrectionEvents('s', 'turn-9', [{
      id: 'corr-9', turnId: 'turn-9', sessionId: 's', type: 'redo', seq: 2,
      targetTool: null, targetSeqHash: null, userText: '换个方式', intent: null, severity: 'medium', createdAt: 1,
    }])
    let loaded = store.queryCorrectionEventsByTurn('turn-9')
    assert(!loaded[0].intent, '初始 intent 为 null')
    store.updateCorrectionIntent('corr-9', '用户要求重做/换方式: 换个方式')
    loaded = store.queryCorrectionEventsByTurn('turn-9')
    assert(loaded[0].intent === '用户要求重做/换方式: 换个方式', 'intent 持久化可读')
  } finally {
    store.close()
  }
})

// ---------------------------------------------------------------------------

console.log('\n--- Correction: Δ7 按工作区避让 + redo 对比对 ---')

test('queryCorrectionEvents(workspaceDigest) 只返回指定工作区纠正', () => {
  const store = new ExperienceStore(':memory:')
  try {
    store.storeCorrectionEvents('s1', 'turn-1', [{
      id: 'w1', turnId: 'turn-1', sessionId: 's1', type: 'revert', seq: 1,
      targetTool: null, targetSeqHash: null, userText: 'A', intent: null, severity: 'high', createdAt: 10,
    }], 'ws-alpha')
    store.storeCorrectionEvents('s2', 'turn-2', [{
      id: 'w2', turnId: 'turn-2', sessionId: 's2', type: 'redo', seq: 1,
      targetTool: null, targetSeqHash: null, userText: 'B', intent: null, severity: 'medium', createdAt: 20,
    }], 'ws-beta')
    assert(store.queryCorrectionEvents(10, 'ws-alpha').length === 1, 'ws-alpha 只 1 条')
    assert(store.queryCorrectionEvents(10, 'ws-alpha')[0].id === 'w1', 'ws-alpha 命中 w1')
    assert(store.queryCorrectionEvents(10, 'ws-beta').length === 1, 'ws-beta 只 1 条')
    assert(store.queryCorrectionEvents(10, 'ws-none').length === 0, '未知工作区 0 条')
  } finally {
    store.close()
  }
})

test('formatCorrectionAdvisory: 生成含标签与 (intent 优先/原话回退) 的避让行', () => {
  const events: CorrectionEvent[] = [{
    id: 'c1', turnId: 't', sessionId: 's', type: 'revert', seq: 1,
    targetTool: null, targetSeqHash: null, userText: '别直接提交', intent: '用临时分支提交', severity: 'high', createdAt: 0,
  }]
  const lines = formatCorrectionAdvisory(events)
  assert(lines[0].includes('do NOT repeat'), '首行避让提示')
  assert(lines.some(l => l.includes('reverted') && l.includes('用临时分支提交')), 'intent 优先')
})

test('penalizeByContentHash: 对匹配 content_hash 的经验降置信度', () => {
  const store = new ExperienceStore(':memory:')
  try {
    const id = store.store(
      {
        turnId: 'turn-1', sessionId: 'session-1', goalProgress: 'advanced',
        toolCallCount: 2, toolSuccessRate: 0.8, guardTriggerCount: 0,
        userFeedback: 'positive', outcomeScore: 0.7, stepEfficiency: 0.9,
        difficulty: 'medium', timestamp: Date.now(),
      },
      {
        taskPattern: 'git', toolsUsed: ['git_commit'], workspaceDigest: 'ws1',
        actions: '{"tools":[{"name":"git_commit","success":true}]}',
      },
    )
    const hash = store.getById(id)!.contentHash
    assert(hash, 'contentHash 存在')
    const before = store.queryExperiencesByContentHash(hash)
    assert(before.length === 1 && before[0].confidence > 0.5, '查得到目标经验')

    const affected = store.penalizeByContentHash(hash, 0.2)
    assert(affected === 1, '打压 1 条')
    const after = store.queryExperiencesByContentHash(hash)
    assert(after[0].confidence < before[0].confidence, '置信度下降')
  } finally {
    store.close()
  }
})

test('queryExperiencesByContentHash: 无匹配返回空', () => {
  const store = new ExperienceStore(':memory:')
  try {
    assert(store.queryExperiencesByContentHash('no-such-hash').length === 0, '无匹配 → 空数组')
    assert(store.penalizeByContentHash('', 0.1) === 0, '空 hash → 0 影响')
  } finally {
    store.close()
  }
})

// ---- Δ7.b: 规则未命中候选 + LLM 兜底判定 ----

test('extractCorrectionCandidates: 抽第2条起、规则未命中的用户消息', () => {
  const events = makeTurn(1, ['list users', '这个我没法接受，接口不该覆盖旧文件', '普通补充'])
  const cands = extractCorrectionCandidates(events, 1)
  // 两条候选都无规则关键词 → 都算候选（交给 LLM 判定）
  assert(cands.length === 2, `应为 2 条候选，实际 ${cands.length}`)
  assert(cands[0].text.includes('没法接受'), '候选0为第一条补充消息')
})

test('classifyCorrectionCandidatesWithLLM: LLM 不可用时返回 null（跳过）', async () => {
  const ctx = { get: () => undefined } // 无 llm → null
  const result = await classifyCorrectionCandidatesWithLLM(ctx, ['没法接受'], undefined)
  assert(result === null, '无 LLM 返回 null')
})

test('classifyCorrectionCandidatesWithLLM: 解析 LLM JSON 数组，忽略非纠正项', async () => {
  // mock llm.stream 逐块吐出一段 JSON 数组（null 表示非纠正 / redo 命中）
  let streamHandled = false
  const ctx = {
    get: (k: string) =>
      k === 'llm' ? {
        stream: async function* (opts: any) {
          streamHandled = true
          assert(opts.messages.length === 1, '批量输入为单次调用')
          yield { type: 'text-delta', text: '[null, {"type":"redo"}]' }
          yield { type: 'finish', reason: { reason: 'stop' } }
        },
      } : undefined,
  }
  const result = await classifyCorrectionCandidatesWithLLM(ctx, ['第一条', '这条是重做'], { provider: 'p', model: 'm' })
  assert(streamHandled, 'LLM stream 被调用')
  assert(result !== null && result.length === 1, `命中 1 条，实际 ${result?.length}`)
  assert(result![0].index === 1 && result![0].type === 'redo', '命中索引1且归类 redo')
})

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed\n`)
// Main entry：await 全部用例（含 Δ7.1 异步 LLM 提取）后汇总。
await runAllTests()