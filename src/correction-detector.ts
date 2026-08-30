/**
 * Correction detector — 检测层（重构计划：以「用户纠正」为黄金信号）
 *
 * 纯函数、确定性、零成本。复用现有 `agent.session.events` 事件流做序列分析，
 * 不新开事件源。输出四分类（revert / redo / correction / interrupt）+ 节点定位
 * (targetTool / targetSeqHash)，作为确定性底座；intent 语义提炼由 LLM 层异步补充。
 *
 * 规则层只负责「归类 + 定位」，不调 LLM，也不做延迟瓶颈。
 */

import { createHash } from 'node:crypto'
import type { CorrectionEvent, CorrectionType } from './types/index.js'
import { extractMessageText } from './index.js'

// ---------------------------------------------------------------------------
// 文本信号：关键词词表（中英文双覆盖）
// ---------------------------------------------------------------------------

const REVERT_KEYWORDS: string[] = [
  // 中文
  '撤销', '回退', '退回', '恢复', '还原', '撤回', '不用', '别做了', '停', '算了',
  '别这样', '回滚', '改回去', '变回去', '滚回去', '不要这个', '不对', '错了',
  '不是这个', '别那样', '到此为止', '停止', '别继续', '收回',
  // 英文
  'undo', 'revert', 'rollback', 'go back', 'back it up', 'take it back',
  'never mind', 'stop', 'cancel', 'abort', 'dismiss', 'ignore that',
  'scratch that', 'forget it', 'put it back', 'restore', 'back out',
  'walk it back', 'wrong', 'nope', 'quit', 'back off', "don't do that",
  'not that way', "that's wrong", 'scratch the last one',
]

const REDO_KEYWORDS: string[] = [
  // 中文
  '重新', '再来', '重做', '再试', '换个方式', '换一种', '再做一遍', '换种', '换一个',
  '重新来', '重来', '换个思路', '另想办法', '重新做', '换条路', '用别的方法', '换别的',
  // 英文
  'redo', 'retry', 'try again', 'do it again', 'start over', 'from scratch',
  'one more time', 'try differently', 'another way', 'different approach',
  "let's try", 're-run', 'rework', 'rephrase', 'reframe', 'give it another go',
  'take another shot', 'revisit', 'different method', 'alternate approach',
]

const CORRECTION_KEYWORDS: string[] = [
  // 中文
  '其实我的意思是', '我说的是', '不是那个', '是这个', '应该改成', '你要理解成',
  '你没懂', '理解错了', '反了', '反着来', '说反了', '弄反了', '反过来了',
  // 英文
  'actually i meant', 'what i wanted was', 'i said', 'not instead', 'rather',
  "that's not what i asked", 'you misunderstood', 'wrong interpretation',
  "that's not it", 'i want instead',
]

/** 关键词归类优先级：correction > revert > redo（相悖语义优先于笼统回退/重做）。 */
export function classifyCorrectionText(text: string): CorrectionType | null {
  const lower = text.toLowerCase()
  for (const kw of CORRECTION_KEYWORDS) {
    if (lower.includes(kw)) return 'correction'
  }
  for (const kw of REVERT_KEYWORDS) {
    if (lower.includes(kw)) return 'revert'
  }
  for (const kw of REDO_KEYWORDS) {
    if (lower.includes(kw)) return 'redo'
  }
  return null
}

/** 把四分类映射为严重度：revert/correction → high，redo/interrupt → medium。 */
export function correctionTypeSeverity(type: CorrectionType): 'high' | 'medium' | 'low' {
  switch (type) {
    case 'revert': return 'high'
    case 'correction': return 'high'
    case 'redo': return 'medium'
    case 'interrupt': return 'medium'
  }
}

/** 从工具序列计算 targetSeqHash（内容指纹，与 experience contentHash 同源思路）。 */
export function computeTargetSeqHash(tools: { name: string; success: boolean }[]): string | null {
  const valid = tools.filter((t) => t && t.name && t.name.length > 0)
  if (valid.length === 0) return null
  const toolStr = valid.map((t) => `${t.name}:${t.success ? '1' : '0'}`).join(',')
  return createHash('sha1').update(toolStr).digest('hex').slice(0, 16)
}

// ---------------------------------------------------------------------------
// 序列分析：打断-重输（interrupt）识别
// ---------------------------------------------------------------------------

interface EventLike {
  type?: string
  seq?: number
  data?: any
}

/** 判断一条 user/message 是否为主题相关（防误报：仅追加补充信息不算纠正）。 */
function isRelatedToTurn(turnText: string, newText: string): boolean {
  if (!turnText || !newText) return true
  const a = new Set(turnText.toLowerCase().split(/\s+/).filter((w) => w.length > 2))
  const b = new Set(newText.toLowerCase().split(/\s+/).filter((w) => w.length > 2))
  if (a.size === 0 || b.size === 0) return true
  let overlap = 0
  for (const w of b) {
    if (a.has(w)) overlap++
  }
  return overlap / Math.min(a.size, b.size) > 0.2 || newText.length <= 20
}

/**
 * 检测一次用户打断-重输事件。
 *
 * @param events 事件流
 * @param turn   当前 turn 号
 * @param tools  当前 turn 已收集的工具序列（用于节点定位）
 * @param sessionId 会话 id
 */
export function detectInterrupt(
  events: EventLike[],
  turn: number,
  tools: { name: string; success: boolean }[],
  sessionId: string,
): CorrectionEvent | null {
  // 找 turn 的 start 与 end 边界
  const startIdx = events.findIndex((e) => e.type === 'turn/start' && e.data?.turn === turn)
  if (startIdx === -1) return null

  // 该 turn 内是否出现「被主动中断」——turn/end reason 为 aborted / interrupted
  let aborted = false
  let endIdx = -1
  for (let i = startIdx; i < events.length; i++) {
    const e = events[i]
    if (e.type === 'turn/end' && e.data?.turn === turn) {
      endIdx = i
      const reason = e.data?.reason
      if (reason?.kind === 'aborted') aborted = true
      break
    }
  }
  // 未主动中断 → 不算 interrupt
  if (!aborted) return null

  // 打断后紧接着是否出现新的真实用户消息（source.kind === 'user'）
  for (let i = (endIdx === -1 ? startIdx : endIdx) + 1; i < events.length; i++) {
    const e = events[i]
    if (e.type === 'turn/start') break // 进入新 turn，停止
    if (e.type === 'user/message' && e.data?.source?.kind === 'user') {
      const userText = extractMessageText(e.data?.content)
      const recoverText = findLatestUserText(events, startIdx)
      if (!isRelatedToTurn(recoverText, userText)) return null
      return {
        id: `interrupt-${turn}-${e.seq ?? Date.now()}`,
        turnId: `turn-${turn}`,
        sessionId,
        type: 'interrupt',
        seq: e.seq ?? -1,
        targetTool: tools.length > 0 ? tools[tools.length - 1].name : null,
        targetSeqHash: computeTargetSeqHash(tools),
        userText: userText.slice(0, 200),
        intent: null,
        severity: correctionTypeSeverity('interrupt'),
        createdAt: Date.now(),
      }
    }
  }
  return null
}

/** 取 turn 内最新一条真实用户文本（用于 interrupt 主题相关性判断）。 */
function findLatestUserText(events: EventLike[], startIdx: number): string {
  let latest = ''
  for (let i = startIdx; i < events.length; i++) {
    const e = events[i]
    if (e.type === 'user/message' && e.data?.source?.kind === 'user') {
      latest = extractMessageText(e.data?.content)
    }
    if (e.type === 'turn/end') break
  }
  return latest
}

/**
 * 主入口：检测一个 turn 内的纠正事件集合（revert / redo / correction）。
 *
 * 命中规则：
 *   1. turn 内第 2 条及后续「真实用户消息」→ 逐条关键词四分类（text 信号）
 *   2. 每次分类命中即与当前工具序列做节点定位
 *   3. 若 turn 被主动中断且随后用户重输 → 追加一条 interrupt
 */
export function detectCorrectionEvents(
  events: EventLike[],
  turn: number,
  tools: { name: string; success: boolean }[],
  sessionId: string,
): CorrectionEvent[] {
  const result: CorrectionEvent[] = []

  const startIdx = events.findIndex((e) => e.type === 'turn/start' && e.data?.turn === turn)
  if (startIdx === -1) return result

  // 收集 turn 内真实用户消息
  const userMsgs: { seq: number; text: string }[] = []
  for (let i = startIdx; i < events.length; i++) {
    const e = events[i]
    if (e.type === 'turn/start' && e.data?.turn !== turn && i !== startIdx) break
    if (e.type === 'turn/end') break
    if (e.type === 'user/message' && e.data?.source?.kind === 'user') {
      userMsgs.push({ seq: e.seq ?? -1, text: extractMessageText(e.data?.content) })
    }
  }

  // 仅当「整个会话第 1 条用户消息」才是任务描述才跳过；后续 turn 有历史用户
  // 消息时，本 turn 首条（可能是提问/纠正）同样参与判定。
  const hasPriorUserMsg = events
    .slice(0, startIdx)
    .some((e) => e.type === 'user/message' && e.data?.source?.kind === 'user')
  for (let i = 0; i < userMsgs.length; i++) {
    if (i === 0 && !hasPriorUserMsg) continue
    const type = classifyCorrectionText(userMsgs[i].text)
    if (!type) continue
    result.push({
      id: `corr-${turn}-${userMsgs[i].seq}`,
      turnId: `turn-${turn}`,
      sessionId,
      type,
      seq: userMsgs[i].seq,
      targetTool: tools.length > 0 ? tools[tools.length - 1].name : null,
      targetSeqHash: computeTargetSeqHash(tools),
      userText: userMsgs[i].text.slice(0, 200),
      intent: null,
      severity: correctionTypeSeverity(type),
      createdAt: Date.now(),
    })
  }

  // interrupt：主动中断 + 重输
  const interrupt = detectInterrupt(events, turn, tools, sessionId)
  if (interrupt) result.push(interrupt)

  return result
}

/**
 * Δ7.b: 抽取「规则未命中」的候选纠正消息（第 2 条起的真实用户消息，关键词归类
 * 判定为非纠正）。这些候选交给异步 LLM 兜底判定，避免遗漏无语义关键词的用户纠正。
 * 同步阶段不因此阻塞或误判——候选仅作 LLM 复查的输入。
 */
export function extractCorrectionCandidates(
  events: EventLike[],
  turn: number,
): { seq: number; text: string }[] {
  const startIdx = events.findIndex((e) => e.type === 'turn/start' && e.data?.turn === turn)
  if (startIdx === -1) return []
  const userMsgs: { seq: number; text: string }[] = []
  for (let i = startIdx; i < events.length; i++) {
    const e = events[i]
    if (e.type === 'turn/start' && e.data?.turn !== turn && i !== startIdx) break
    if (e.type === 'turn/end') break
    if (e.type === 'user/message' && e.data?.source?.kind === 'user') {
      userMsgs.push({ seq: e.seq ?? -1, text: extractMessageText(e.data?.content) })
    }
  }
  // 仅跳会话第 1 条用户消息（任务描述）；后续 turn 首条（提问/纠正）也作候选。
  const hasPriorUserMsg = events
    .slice(0, startIdx)
    .some((e) => e.type === 'user/message' && e.data?.source?.kind === 'user')
  return userMsgs
    .filter((m, i) => {
      if (i === 0 && !hasPriorUserMsg) return false
      return !classifyCorrectionText(m.text)
    })
}

/** 从 CorrectionEvent[] 汇总成评分层用的 CorrectionSignal。 */
export function toCorrectionSignal(events: CorrectionEvent[]): {
  count: number
  severity: 'high' | 'medium' | 'low' | null
} {
  if (events.length === 0) return { count: 0, severity: null }
  let highest: 'high' | 'medium' | 'low' = 'low'
  for (const e of events) {
    if (e.severity === 'high') highest = 'high'
    else if (e.severity === 'medium' && highest !== 'high') highest = 'medium'
  }
  return { count: events.length, severity: highest }
}

/**
 * Δ7.1: Rule-based correction intent fallback — when LLM is unavailable.
 * The user's correction text itself is already a short directive, so the
 * fallback keeps it as-is (trimmed) with a type hint for downstream injection.
 */
export function extractCorrectionIntentRuleBased(event: CorrectionEvent): string {
  const text = event.userText?.trim()
  if (!text) return ''
  const typeHint =
    event.type === 'revert' ? '用户要求撤销/回退' :
    event.type === 'redo' ? '用户要求重做/换方式' :
    event.type === 'interrupt' ? '用户打断并重新表述' :
    '用户纠正了做法'
  return `${typeHint}: ${text.slice(0, 140)}`
}

/**
 * 注入层：把纠正事件格式化为「避让被纠正做法」的 advisory 行（供 pre-step 与
 * systemPrompt.section 复用）。优先用提炼后的 intent，回退用用户原话。
 */
export function formatCorrectionAdvisory(events: CorrectionEvent[]): string[] {
  const typeLabel: Record<CorrectionType, string> = {
    revert: 'reverted', redo: 'redone', interrupt: 'interrupted', correction: 'corrected',
  }
  return [
    '- User has rejected/corrected these approaches — do NOT repeat them:',
    ...events.map(c => `  * ${typeLabel[c.type]}: ${(c.intent ?? c.userText).slice(0, 120)}`),
  ]
}